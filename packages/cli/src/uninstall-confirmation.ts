export type ResolveUninstallConfirmationOptions = {
  confirmedByFlag: boolean;
  isInteractive: boolean;
  askConfirmation: () => Promise<string>;
};

export type ResolveUninstallDataRetentionOptions = {
  keepDataByFlag: boolean;
  shouldPrompt: boolean;
  askConfirmation: () => Promise<string>;
};

const normalizeConfirmation = (value: string) => value.trim().toLowerCase();

const affirmativeAnswers = new Set(["y", "yes"]);

const isAffirmativeAnswer = (value: string) =>
  affirmativeAnswers.has(normalizeConfirmation(value));

export const resolveUninstallConfirmation = async ({
  confirmedByFlag,
  isInteractive,
  askConfirmation,
}: ResolveUninstallConfirmationOptions) => {
  if (confirmedByFlag) {
    return true;
  }

  if (!isInteractive) {
    return false;
  }

  const answer = await askConfirmation();
  return isAffirmativeAnswer(answer);
};

export const resolveUninstallDataRetention = async ({
  keepDataByFlag,
  shouldPrompt,
  askConfirmation,
}: ResolveUninstallDataRetentionOptions) => {
  if (keepDataByFlag) {
    return true;
  }

  if (!shouldPrompt) {
    return false;
  }

  const answer = await askConfirmation();
  return isAffirmativeAnswer(answer);
};
