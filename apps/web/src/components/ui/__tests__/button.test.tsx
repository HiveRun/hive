import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../button";

const CLICK_ME_REGEX = /click me/i;
const DELETE_REGEX = /delete/i;
const SMALL_BUTTON_REGEX = /small button/i;
const DISABLED_BUTTON_REGEX = /disabled button/i;

describe("Button", () => {
  it("renders with default props", () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole("button", { name: CLICK_ME_REGEX });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("inline-flex");
  });

  it("renders with variant prop", () => {
    render(<Button variant="destructive">Delete</Button>);

    const button = screen.getByRole("button", { name: DELETE_REGEX });
    expect(button).toHaveClass("bg-destructive");
  });

  it("renders with size prop", () => {
    render(<Button size="sm">Small button</Button>);

    const button = screen.getByRole("button", { name: SMALL_BUTTON_REGEX });
    expect(button).toHaveClass("h-8");
  });

  it("can be disabled", () => {
    render(<Button disabled>Disabled button</Button>);

    const button = screen.getByRole("button", { name: DISABLED_BUTTON_REGEX });
    expect(button).toBeDisabled();
  });
});
