import { describe, it, expect } from "vitest";
import { validateBranchName } from "../src/shared/validation";

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(validateBranchName("feature/my-branch")).toBeNull();
    expect(validateBranchName("graft/readme")).toBeNull();
    expect(validateBranchName("fix-123")).toBeNull();
    expect(validateBranchName("v1.0")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateBranchName("")).not.toBeNull();
    expect(validateBranchName("   ")).not.toBeNull();
  });

  it("rejects spaces", () => {
    expect(validateBranchName("my branch")).not.toBeNull();
  });

  it("rejects double dots", () => {
    expect(validateBranchName("a..b")).not.toBeNull();
  });

  it("rejects tilde", () => {
    expect(validateBranchName("a~b")).not.toBeNull();
  });

  it("rejects caret", () => {
    expect(validateBranchName("a^b")).not.toBeNull();
  });

  it("rejects colon", () => {
    expect(validateBranchName("a:b")).not.toBeNull();
  });

  it("rejects backslash", () => {
    expect(validateBranchName("a\\b")).not.toBeNull();
  });

  it("rejects bracket", () => {
    expect(validateBranchName("a[b")).not.toBeNull();
  });

  it("rejects leading dash", () => {
    expect(validateBranchName("-branch")).not.toBeNull();
  });

  it("rejects leading dot", () => {
    expect(validateBranchName(".branch")).not.toBeNull();
  });

  it("rejects trailing dot", () => {
    expect(validateBranchName("branch.")).not.toBeNull();
  });

  it("rejects .lock ending", () => {
    expect(validateBranchName("branch.lock")).not.toBeNull();
  });

  it("rejects trailing slash", () => {
    expect(validateBranchName("branch/")).not.toBeNull();
  });

  it("rejects /. sequence", () => {
    expect(validateBranchName("a/.b")).not.toBeNull();
  });

  it("rejects // sequence", () => {
    expect(validateBranchName("a//b")).not.toBeNull();
  });
});
