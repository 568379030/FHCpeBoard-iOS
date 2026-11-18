/*
 * SmsPdu.js — 3GPP TS 23.038 / 23.040 SMS PDU decoder.
 *
 * Drop-in replacement for the Android native symbol
 *   Java_com_fhcpeboard_android_NativeCore_nativeDecodeSmsPdu
 *
 * Contract (as consumed by air6_api.js:50):
 *   decodeSmsPdu(hexString) -> JSON string
 *   { ok:true, outgoing:Boolean, number:String, time:String, text:String }
 *   or "null" when the PDU cannot be decoded.
 *
 * Works in the iOS WebView and under Node (module.exports) so the decoder can
 * be unit-tested off-device.
 */
(function (root) {
  'use strict';

  // GSM 03.38 default alphabet, 128 entries, ESC (0x1B) at index 27.
  var GSM7 = '@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u001b\u00c6\u00e6\u00df\u00c9 !"#\u00a4%&\'()*+,-./0123456789:;<=>?\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0';

  // GSM 03.38 extension table (reached through ESC).
  var GSM7_EXT = {
    0x0a: '\f', 0x14: '^', 0x28: '{', 0x29: '}', 0x2f: '\\',
    0x3c: '[', 0x3d: '~', 0x3e: ']', 0x40: '|', 0x65: '\u20ac'
  };

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function hexToBytes(hex) {
    if (typeof hex !== 'string') return null;
    var clean = hex.replace(/[\s:.-]/g, '').toUpperCase();
    if (!clean || clean.length % 2 !== 0 || !/^[0-9A-F]+$/.test(clean)) return null;
    var out = new Array(clean.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  // Unpack N septets from packed octets, dropping the first `skip` septets.
  function unpackSeptets(bytes, septetCount, skip) {
    var out = [], buffer = 0, bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      buffer |= bytes[i] << bits;
      bits += 8;
      while (bits >= 7) {
        out.push(buffer & 0x7f);
        buffer >>= 7;
        bits -= 7;
      }
    }
    return out.slice(skip || 0, (skip || 0) + septetCount);
  }

  function decodeGsm7(septets, limit) {
    var text = '';
    for (var i = 0; i < septets.length && (limit == null || text.length < limit); i++) {
      var s = septets[i];
      if (s === 0x1b) {
        if (i + 1 >= septets.length) break;
        var ext = GSM7_EXT[septets[++i]];
        text += ext === undefined ? ' ' : ext;
      } else {
        text += GSM7.charAt(s);
      }
    }
    return text;
  }

  function decodeUtf16Be(bytes) {
    var text = '';
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      var unit = (bytes[i] << 8) | bytes[i + 1];
      if (unit === 0) continue;
      text += String.fromCharCode(unit);
    }
    return text;
  }

  // TP-SCTS: 7 semi-octet swapped BCD values (y m d h m s tz).
  function decodeTimestamp(d, o) {
    function swapped(b) { return (b & 0x0f) * 10 + ((b >> 4) & 0x0f); }
    var yy = swapped(d[o]), mo = swapped(d[o + 1]), dd = swapped(d[o + 2]);
    var hh = swapped(d[o + 3]), mi = swapped(d[o + 4]), ss = swapped(d[o + 5]);
    if (yy > 99 || mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return '';
    var year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return year + '/' + pad2(mo) + '/' + pad2(dd) + ' ' + pad2(hh) + ':' + pad2(mi) + ':' + pad2(ss);
  }

  // TP-OA / TP-DA. Returns { number, next }.
  function decodeAddress(d, o) {
    var digits = d[o];
    if (digits === undefined) return null;
    var toa = d[o + 1];
    if (toa === undefined) return null;
    var byteCount = Math.ceil(digits / 2);
    var start = o + 2;
    if (start + byteCount > d.length) return null;

    if ((toa & 0x70) === 0x50) {
      // Alphanumeric originator, packed GSM 7-bit.
      var septets = unpackSeptets(d.slice(start, start + byteCount), Math.floor(digits * 4 / 7), 0);
      return { number: decodeGsm7(septets), next: start + byteCount };
    }

    var text = '';
    for (var i = 0; i < byteCount && text.length < digits; i++) {
      var b = d[start + i];
      var lo = b & 0x0f, hi = (b >> 4) & 0x0f;
      if (lo <= 9) text += lo;
      if (hi <= 9 && text.length < digits) text += hi;
    }
    if ((toa & 0x70) === 0x10 && text.charAt(0) !== '+') text = '+' + text;
    return { number: text, next: start + byteCount };
  }

  // Which alphabet the TP-UD uses (23.038 §4).
  function alphabetOf(dcs) {
    if (!(dcs & 0x80)) {
      var a = (dcs >> 2) & 0x03;
      return a === 1 ? '8bit' : a === 2 ? 'ucs2' : 'gsm7';
    }
    var group = (dcs >> 4) & 0x03;
    if (group === 2) return 'ucs2';
    if (group === 3) return 'gsm7';
    var b = (dcs >> 2) & 0x03;
    return b === 1 ? '8bit' : b === 2 ? 'ucs2' : 'gsm7';
  }

  function decode(hex) {
    var d = hexToBytes(hex);
    if (!d || d.length < 2) return null;

    var o = 0;
    var smscLen = d[o];                       // SMSC info length in octets
    o += 1 + smscLen;
    if (o >= d.length) return null;

    var first = d[o];
    o += 1;
    var mti = first & 0x03;
    var udhi = (first & 0x40) !== 0;
    var number = '', time = '', text = '', outgoing = false;

    if (mti === 0) {
      // SMS-DELIVER: TP-OA, TP-PID, TP-DCS, TP-SCTS, TP-UDL, TP-UD
      var oa = decodeAddress(d, o);
      if (!oa) return null;
      number = oa.number;
      o = oa.next;
      var pid = d[o]; o += 1;
      var dcs = d[o]; o += 1;
      time = decodeTimestamp(d, o); o += 7;
      var udl = d[o]; o += 1;
      text = decodeUserData(d, o, udl, dcs, udhi);
    } else if (mti === 1) {
      // SMS-SUBMIT: TP-MR, TP-DA, TP-PID, TP-DCS, TP-VP*, TP-UDL, TP-UD
      outgoing = true;
      o += 1;                                  // TP-MR
      var da = decodeAddress(d, o);
      if (!da) return null;
      number = da.number;
      o = da.next;
      var spid = d[o]; o += 1;
      var sdcs = d[o]; o += 1;
      var vpf = (first >> 3) & 0x03;
      o += vpf === 0 ? 0 : vpf === 2 ? 1 : vpf === 1 ? 1 : 7;
      var sudl = d[o]; o += 1;
      text = decodeUserData(d, o, sudl, sdcs, udhi);
      time = '';
    } else if (mti === 2) {
      // SMS-STATUS-REPORT: treat as an outbound entry with no body.
      outgoing = true;
      o += 1;                                  // TP-MR
      var ra = decodeAddress(d, o);
      if (!ra) return null;
      number = ra.number;
      o = ra.next;
      time = decodeTimestamp(d, o);
      text = '';
    } else {
      return null;
    }

    if (text == null) text = '';
    return { ok: true, outgoing: outgoing, number: number, time: time, text: text };
  }

  function decodeUserData(d, offset, udl, dcs, udhi) {
    var alphabet = alphabetOf(dcs);
    if (alphabet === 'gsm7') {
      var octets = Math.ceil((udl * 7) / 8);
      var block = d.slice(offset, offset + octets);
      var skip = 0;
      if (udhi && block.length) skip = Math.ceil(((block[0] + 1) * 8) / 7);
      return decodeGsm7(unpackSeptets(block, udl, skip), udl);
    }
    var start = offset + (udhi && d[offset] !== undefined ? d[offset] + 1 : 0);
    var body = d.slice(start, offset + udl);
    if (alphabet === 'ucs2') return decodeUtf16Be(body);
    var ascii = '';
    for (var i = 0; i < body.length; i++) ascii += String.fromCharCode(body[i]);
    return ascii;
  }

  function decodeSmsPdu(hex) {
    try {
      var result = decode(hex);
      return result ? JSON.stringify(result) : 'null';
    } catch (e) {
      return 'null';
    }
  }

  decodeSmsPdu.GSM7 = GSM7;
  root.__SmsPdu = decodeSmsPdu;
  if (typeof module !== 'undefined' && module.exports) module.exports = decodeSmsPdu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
