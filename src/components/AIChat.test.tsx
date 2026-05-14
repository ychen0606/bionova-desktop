import { describe, it, expect } from "vitest";
import { extractPatches } from "./AIChat";

describe("AIChat extractPatches", () => {
  it("returns empty for plain text", () => {
    expect(extractPatches("just a regular reply, no patches")).toEqual([]);
  });

  it("parses single python patch with cell_id", () => {
    const text = `先这样:
<bionova_patch cell_id="abc-123">
\`\`\`python
import scanpy as sc
adata = sc.read_h5ad("data/x.h5ad")
\`\`\`
</bionova_patch>
完。`;
    const patches = extractPatches(text);
    expect(patches.length).toBe(1);
    expect(patches[0].cellId).toBe("abc-123");
    expect(patches[0].code).toContain("scanpy");
  });

  it("parses multiple patches", () => {
    const text = `<bionova_patch cell_id="c1">\n\`\`\`python\na = 1\n\`\`\`\n</bionova_patch>\n<bionova_patch cell_id="c2">\n\`\`\`py\nb = 2\n\`\`\`\n</bionova_patch>`;
    const patches = extractPatches(text);
    expect(patches.length).toBe(2);
    expect(patches[0].cellId).toBe("c1");
    expect(patches[1].cellId).toBe("c2");
  });
});
