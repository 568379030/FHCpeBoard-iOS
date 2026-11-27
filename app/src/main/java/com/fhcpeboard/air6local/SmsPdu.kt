package com.fhcpeboard.air6local

import org.json.JSONObject

/**
 * 3GPP TS 23.038 / 23.040 SMS PDU 解码器。
 * 移植自 FHCpeBoard-iOS/Web/SmsPdu.js（已在 Node 上用多组样本验证），
 * 替代原 so 的 nativeDecodeSmsPdu。
 *
 * 契约：decode(hex) -> JSON 字符串
 *   { ok:true, outgoing:Boolean, number:String, time:String, text:String }
 *   无法解码返回 "null"
 */
object SmsPdu {
    private const val GSM7 = "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

    private val GSM7_EXT = mapOf(
        0x0a to '\u000C', 0x14 to '^', 0x28 to '{', 0x29 to '}', 0x2f to '\\',
        0x3c to '[', 0x3d to '~', 0x3e to ']', 0x40 to '|', 0x65 to '€'
    )

    fun decode(hex: String): String {
        return try {
            val d = hexToBytes(hex) ?: return "null"
            val result = decodePdu(d) ?: return "null"
            JSONObject().apply {
                put("ok", true)
                put("outgoing", result.outgoing)
                put("number", result.number)
                put("time", result.time)
                put("text", result.text)
            }.toString()
        } catch (_: Exception) {
            "null"
        }
    }

    private data class Decoded(val outgoing: Boolean, val number: String, val time: String, val text: String)
    private data class Address(val number: String, val next: Int)

    private fun hexToBytes(hex: String): IntArray? {
        val clean = hex.replace(Regex("[\\s:.-]"), "").uppercase()
        if (clean.isEmpty() || clean.length % 2 != 0 || !clean.matches(Regex("[0-9A-F]+"))) return null
        val out = IntArray(clean.length / 2)
        for (i in out.indices) {
            out[i] = clean.substring(i * 2, i * 2 + 2).toInt(16)
        }
        return out
    }

    private fun pad2(n: Int): String = if (n < 10) "0$n" else "$n"

    /** 从打包的 octet 里解出 septet，跳过前 skip 个 */
    private fun unpackSeptets(bytes: IntArray, septetCount: Int, skip: Int): IntArray {
        val out = mutableListOf<Int>()
        var buffer = 0
        var bits = 0
        for (b in bytes) {
            buffer = buffer or (b shl bits)
            bits += 8
            while (bits >= 7) {
                out.add(buffer and 0x7f)
                buffer = buffer shr 7
                bits -= 7
            }
        }
        val from = skip.coerceAtLeast(0)
        val to = (from + septetCount).coerceAtMost(out.size)
        return if (from >= to) IntArray(0) else out.subList(from, to).toIntArray()
    }

    private fun decodeGsm7(septets: IntArray, limit: Int? = null): String {
        val sb = StringBuilder()
        var i = 0
        while (i < septets.size && (limit == null || sb.length < limit)) {
            val s = septets[i]
            if (s == 0x1b) {
                if (i + 1 >= septets.size) break
                val ext = GSM7_EXT[septets[++i]]
                sb.append(ext ?: ' ')
            } else {
                sb.append(GSM7[s])
            }
            i++
        }
        return sb.toString()
    }

    private fun decodeUtf16Be(bytes: IntArray): String {
        val sb = StringBuilder()
        var i = 0
        while (i + 1 < bytes.size) {
            val unit = (bytes[i] shl 8) or bytes[i + 1]
            if (unit != 0) sb.append(unit.toChar())
            i += 2
        }
        return sb.toString()
    }

    private fun swapped(b: Int): Int = (b and 0x0f) * 10 + ((b shr 4) and 0x0f)

    private fun decodeTimestamp(d: IntArray, o: Int): String {
        if (o + 6 >= d.size) return ""
        val yy = swapped(d[o]); val mo = swapped(d[o + 1]); val dd = swapped(d[o + 2])
        val hh = swapped(d[o + 3]); val mi = swapped(d[o + 4]); val ss = swapped(d[o + 5])
        if (yy > 99 || mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return ""
        val year = if (yy >= 70) 1900 + yy else 2000 + yy
        return "$year/${pad2(mo)}/${pad2(dd)} ${pad2(hh)}:${pad2(mi)}:${pad2(ss)}"
    }

    private fun decodeAddress(d: IntArray, o: Int): Address? {
        if (o + 1 >= d.size) return null
        val digits = d[o]
        val toa = d[o + 1]
        val byteCount = (digits + 1) / 2
        val start = o + 2
        if (start + byteCount > d.size) return null

        if ((toa and 0x70) == 0x50) {
            val block = d.copyOfRange(start, start + byteCount)
            val septets = unpackSeptets(block, (digits * 4) / 7, 0)
            return Address(decodeGsm7(septets), start + byteCount)
        }

        val sb = StringBuilder()
        var i = 0
        while (i < byteCount && sb.length < digits) {
            val b = d[start + i]
            val lo = b and 0x0f
            val hi = (b shr 4) and 0x0f
            if (lo <= 9) sb.append(lo)
            if (hi <= 9 && sb.length < digits) sb.append(hi)
            i++
        }
        var text = sb.toString()
        if ((toa and 0x70) == 0x10 && !text.startsWith("+")) text = "+$text"
        return Address(text, start + byteCount)
    }

    private fun alphabetOf(dcs: Int): String {
        if ((dcs and 0x80) == 0) {
            return when ((dcs shr 2) and 0x03) { 1 -> "8bit"; 2 -> "ucs2"; else -> "gsm7" }
        }
        return when ((dcs shr 4) and 0x03) {
            2 -> "ucs2"
            3 -> "gsm7"
            else -> when ((dcs shr 2) and 0x03) { 1 -> "8bit"; 2 -> "ucs2"; else -> "gsm7" }
        }
    }

    private fun decodeUserData(d: IntArray, offset: Int, udl: Int, dcs: Int, udhi: Boolean): String {
        val alphabet = alphabetOf(dcs)
        if (alphabet == "gsm7") {
            val octets = (udl * 7 + 7) / 8
            val end = (offset + octets).coerceAtMost(d.size)
            val block = d.copyOfRange(offset, end)
            var skip = 0
            if (udhi && block.isNotEmpty()) skip = ((block[0] + 1) * 8 + 6) / 7
            return decodeGsm7(unpackSeptets(block, udl, skip), udl)
        }
        val start = offset + if (udhi && offset < d.size) d[offset] + 1 else 0
        val end = (offset + udl).coerceAtMost(d.size)
        val body = if (start < end) d.copyOfRange(start, end) else IntArray(0)
        if (alphabet == "ucs2") return decodeUtf16Be(body)
        return body.map { it.toChar() }.joinToString("")
    }

    private fun decodePdu(d: IntArray): Decoded? {
        if (d.size < 2) return null
        var o = 0
        val smscLen = d[o]
        o += 1 + smscLen
        if (o >= d.size) return null

        val first = d[o]
        o += 1
        val mti = first and 0x03
        val udhi = (first and 0x40) != 0
        var number = ""
        var time = ""
        var text = ""
        var outgoing = false

        when (mti) {
            0 -> {
                val oa = decodeAddress(d, o) ?: return null
                number = oa.number; o = oa.next
                if (o + 1 >= d.size) return null
                val dcs = d[o + 1]; o += 2
                time = decodeTimestamp(d, o); o += 7
                if (o >= d.size) return null
                val udl = d[o]; o += 1
                text = decodeUserData(d, o, udl, dcs, udhi)
            }
            1 -> {
                outgoing = true
                o += 1
                val da = decodeAddress(d, o) ?: return null
                number = da.number; o = da.next
                if (o + 1 >= d.size) return null
                val sdcs = d[o + 1]; o += 2
                val vpf = (first shr 3) and 0x03
                o += when (vpf) { 0 -> 0; 2 -> 1; 1 -> 1; else -> 7 }
                if (o >= d.size) return null
                val sudl = d[o]; o += 1
                text = decodeUserData(d, o, sudl, sdcs, udhi)
                time = ""
            }
            2 -> {
                outgoing = true
                o += 1
                val ra = decodeAddress(d, o) ?: return null
                number = ra.number; o = ra.next
                time = decodeTimestamp(d, o)
                text = ""
            }
            else -> return null
        }
        return Decoded(outgoing, number, time, text)
    }
}
