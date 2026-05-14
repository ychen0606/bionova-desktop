import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanReview } from "./PlanReview";

describe("PlanReview", () => {
  const cards = [
    { id: "qc", title: "质控", rationale: "过滤低质量" },
    { id: "cluster", title: "聚类", rationale: "Leiden" },
  ];

  it("renders all proposed cards", () => {
    render(<PlanReview cards={cards} onAccept={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("plan-card-qc")).toBeInTheDocument();
    expect(screen.getByTestId("plan-card-cluster")).toBeInTheDocument();
  });

  it("accept returns only checked cards with edited titles", () => {
    const onAccept = vi.fn();
    render(<PlanReview cards={cards} onAccept={onAccept} onCancel={() => {}} />);
    // Uncheck second card
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    // Edit first card title
    const titleInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "质控 v2" } });
    fireEvent.click(screen.getByTestId("plan-review-accept"));
    expect(onAccept).toHaveBeenCalledWith([
      { id: "qc", title: "质控 v2", rationale: "过滤低质量" },
    ]);
  });

  it("cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    render(<PlanReview cards={cards} onAccept={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("plan-review-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
