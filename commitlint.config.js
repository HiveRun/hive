const SUBJECT_MAX_LENGTH = 72;
const BODY_MAX_LINE_LENGTH = 100;

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "subject-case": [2, "never", ["pascal-case", "upper-case"]],
    "subject-max-length": [2, "always", SUBJECT_MAX_LENGTH],
    "body-max-line-length": [2, "always", BODY_MAX_LINE_LENGTH],
  },
};
