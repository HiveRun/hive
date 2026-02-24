export type ResolveUninstallConfirmationOptions = {
  confirmedByFlag: boolean;
  isInteractive: boolean;
  askConfirmation: () => Promise<string>;
};

const normalizeConfirmation = (value: string) => value.trim().toLowerCase();

const affirmativeAnswers = new Set(["y", "yes"]);

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
  return affirmativeAnswers.has(normalizeConfirmation(answer));
};
