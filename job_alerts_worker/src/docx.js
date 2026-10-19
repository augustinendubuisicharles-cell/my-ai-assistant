// A tailored CV as a real Word file (.docx), built by the Worker from the CV text (POST /cv/<token>/docx).
// It used to be built in the browser, but phone in-app browsers (the Google app, Chrome on iPhone) silently
// ignore those downloads; a normal file response downloads everywhere.
// First line = name (big, bold); short ALL-CAPS lines = section headings; "- " lines = bullets; the rest = paragraphs.

// The download's file name, e.g. "CV - PR Associate - Acme.docx".
export const cvFileName = (job) =>
  `CV - ${job.title}${job.company ? ` - ${job.company}` : ""}`.replace(/[^\w .,&()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".docx";

export function cvDocx(text) {
  var esc = function (s) { return s.replace(/&/g, "&amp;").replace(/[<]/g, "&lt;").replace(/>/g, "&gt;"); };
  var run = function (t, props) {
    return "<w:r><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>" + (props || "") +
      "</w:rPr><w:t xml:space=\"preserve\">" + esc(t) + "</w:t></w:r>";
  };
  var body = [];
  text.split("\n").forEach(function (l, i) {
    var t = l.trim();
    if (!t) return;
    if (/^[-•*] /.test(t)) {
      body.push("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"40\"/><w:ind w:left=\"360\" w:hanging=\"240\"/></w:pPr>" +
        run("•\t" + t.slice(2).trim(), "<w:sz w:val=\"22\"/>") + "</w:p>");
    } else if (i === 0) {
      body.push("<w:p><w:pPr><w:spacing w:after=\"80\"/></w:pPr>" + run(t, "<w:b/><w:sz w:val=\"36\"/>") + "</w:p>");
    } else if (t.length < 40 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      body.push("<w:p><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"999999\"/></w:pBdr>" +
        "<w:spacing w:before=\"280\" w:after=\"80\"/></w:pPr>" + run(t, "<w:b/><w:sz w:val=\"24\"/>") + "</w:p>");
    } else {
      body.push("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"60\"/></w:pPr>" + run(t, "<w:sz w:val=\"22\"/>") + "</w:p>");
    }
  });
  var files = {
    "[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
    "_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
    "word/document.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
      body.join("") + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>",
  };
  // A zip with no compression ("stored"), which Word, Pages and Google Docs all open.
  var crcTable = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  var crc32 = function (b) {
    var c = 0xffffffff;
    for (var i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  var enc = new TextEncoder(), parts = [], central = [], offset = 0;
  var head = function (sig, size) { var v = new DataView(new ArrayBuffer(size)); v.setUint32(0, sig, true); return v; };
  Object.keys(files).forEach(function (name) {
    var nameB = enc.encode(name), data = enc.encode(files[name]), crc = crc32(data);
    var h = head(0x04034b50, 30);
    h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true);
    var d = head(0x02014b50, 46);
    d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, nameB.length, true); d.setUint32(42, offset, true);
    parts.push(new Uint8Array(h.buffer), nameB, data);
    central.push(new Uint8Array(d.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  });
  var size = central.reduce(function (s, b) { return s + b.length; }, 0), count = Object.keys(files).length;
  var e = head(0x06054b50, 22);
  e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  var all = parts.concat(central, [new Uint8Array(e.buffer)]), out = new Uint8Array(offset + size + 22), at = 0;
  all.forEach(function (b) { out.set(b, at); at += b.length; });
  return out;
}
