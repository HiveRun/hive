export const captureEnv = (keys: string[]) => {
  const previousValues = keys.map((key) => [key, process.env[key]] as const);

  return () => {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

export const setEnv = (key: string, value: string) => {
  process.env[key] = value;
};
