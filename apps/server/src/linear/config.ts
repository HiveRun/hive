export const getLinearTokenEncryptionSecret = () => {
  const value = process.env.LINEAR_TOKEN_ENCRYPTION_SECRET?.trim();
  return value && value.length > 0 ? value : null;
};
