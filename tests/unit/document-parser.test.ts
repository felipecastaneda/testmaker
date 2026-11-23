import { beforeAll, describe, expect, it } from "vitest";
import { extractTextFromFile } from "@/lib/document-parser";
import { createZip } from "@/lib/zip-writer";
import { installXmlDom } from "./setup-dom";

beforeAll(installXmlDom);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>
  <w:p><w:r><w:t>Photosynthesis</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Plants convert </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>light energy</w:t></w:r><w:r><w:t xml:space="preserve"> into chemical energy.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t><w:tab/><w:t>tabbed – ñ 日本</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

const XLSX_PARTS = {
  "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Terms" sheetId="1" r:id="rId1"/><sheet name="Numbers" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Term</t></si><si><t>Definition</t></si><si><t>Mitochondria</t></si><si><r><t>Power</t></r><r><t>house of the cell</t></r></si></sst>`,
  "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Inline</t></is></c><c r="B3" t="b"><v>1</v></c></row>
  </sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><v>3.14</v></c></row></sheetData></worksheet>`,
};

async function zipFile(name: string, parts: Record<string, string>, compress: boolean) {
  const bytes = await createZip(
    Object.entries(parts).map(([n, data]) => ({ name: n, data })),
    { compress }
  );
  return new File([bytes as BlobPart], name);
}

describe("extractTextFromFile", () => {
  for (const compress of [true, false]) {
    describe(compress ? "deflated archives" : "stored archives", () => {
      it("extracts paragraphs, runs, breaks, tabs and tables from .docx", async () => {
        const file = await zipFile("notes.docx", { "word/document.xml": DOCUMENT_XML }, compress);
        expect(await extractTextFromFile(file)).toBe(
          "Photosynthesis\nPlants convert light energy into chemical energy.\nLine one\nLine two\ttabbed – ñ 日本\nCell A\nCell B"
        );
      });

      it("extracts shared, rich, inline and boolean cells from every .xlsx sheet", async () => {
        const file = await zipFile("terms.xlsx", XLSX_PARTS, compress);
        expect(await extractTextFromFile(file)).toBe(
          "## Terms\nTerm\tDefinition\nMitochondria\tPowerhouse of the cell\nInline\tTRUE\n\n## Numbers\n42\t3.14"
        );
      });
    });
  }

  it("reads plain text formats as-is", async () => {
    expect(await extractTextFromFile(new File(["# Heading\nbody"], "notes.md"))).toBe("# Heading\nbody");
    expect(await extractTextFromFile(new File(["a,b\n1,2"], "data.csv"))).toBe("a,b\n1,2");
  });

  it("rejects files that aren't Office documents", async () => {
    await expect(extractTextFromFile(new File(["not a zip"], "fake.docx"))).rejects.toThrow(/valid Office document/);
  });

  it("explains when a .docx has no document body", async () => {
    const file = await zipFile("empty.docx", { "foo.txt": "hi" }, true);
    await expect(extractTextFromFile(file)).rejects.toThrow(/document body/);
  });

  it("asks users to convert legacy formats", async () => {
    await expect(extractTextFromFile(new File(["x"], "old.doc"))).rejects.toThrow(/\.docx/);
  });

  it("rejects unknown extensions", async () => {
    await expect(extractTextFromFile(new File(["x"], "image.png"))).rejects.toThrow(/Unsupported file type/);
  });
});
