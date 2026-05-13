import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Outputs } from "./Outputs";

describe("Outputs", () => {
  it("renders nothing for empty", () => {
    const { container } = render(<Outputs outputs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders stream stdout", () => {
    render(
      <Outputs
        outputs={[{ output_type: "stream", name: "stdout", text: "hello\n" }]}
      />
    );
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it("renders image/png", () => {
    render(
      <Outputs
        outputs={[
          {
            output_type: "display_data",
            data: { "image/png": "iVBORw0KGgo=" },
          },
        ]}
      />
    );
    const img = screen.getByAltText("output") as HTMLImageElement;
    expect(img.src).toContain("base64,iVBORw0KGgo=");
  });

  it("renders error", () => {
    render(
      <Outputs
        outputs={[
          {
            output_type: "error",
            ename: "NameError",
            evalue: "name 'x' is not defined",
            traceback: ["Traceback…", "NameError: name 'x' is not defined"],
          },
        ]}
      />
    );
    expect(screen.getByText(/NameError/)).toBeInTheDocument();
  });
});
