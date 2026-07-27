import { fireEvent, render, screen } from "@testing-library/react";
import { JsonTree } from "../json-tree";
import { PALETTES } from "../theme";

const palette = PALETTES.dark;

describe("JsonTree", () => {
  it("renders keys and typed primitives", () => {
    const { container } = render(
      <JsonTree
        value={{ id: "1", n: 42, ok: true, nothing: null }}
        palette={palette}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("id");
    expect(text).toContain('"1"');
    expect(text).toContain("42");
    expect(text).toContain("true");
    expect(text).toContain("null");
  });

  it("collapses nodes deeper than the default depth, then expands on click", () => {
    const { container } = render(
      <JsonTree
        value={{ outer: { inner: "deep" } }}
        palette={palette}
        defaultExpandedDepth={1}
      />,
    );
    expect(container.textContent).not.toContain("deep");

    fireEvent.click(screen.getByLabelText("expand"));
    expect(container.textContent).toContain("deep");
  });

  it("highlights search matches with a mark", () => {
    const { container } = render(
      <JsonTree value={{ name: "Taha" }} palette={palette} search="ta" />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]?.textContent?.toLowerCase()).toBe("ta");
  });

  it("guards circular references", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const { container } = render(<JsonTree value={circular} palette={palette} />);
    expect(container.textContent).toContain("[Circular]");
  });

  it("normalizes Error, Map and Date", () => {
    const { container: err } = render(
      <JsonTree value={new Error("boom")} palette={palette} />,
    );
    expect(err.textContent).toContain("message");
    expect(err.textContent).toContain("boom");

    const { container: map } = render(
      <JsonTree value={new Map([["a", 1]])} palette={palette} />,
    );
    expect(map.textContent).toContain("a");
    expect(map.textContent).toContain("1");

    const { container: date } = render(
      <JsonTree value={{ at: new Date(0) }} palette={palette} />,
    );
    expect(date.textContent).toContain("1970");
  });
});
