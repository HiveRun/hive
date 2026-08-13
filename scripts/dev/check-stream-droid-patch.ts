import { dirname, join } from "node:path";

const root = join(import.meta.dir, "../..");
const androidRuntime = join(root, "packages/android-runtime");
const packageJsonPath = Bun.resolveSync(
  "stream-droid/package.json",
  androidRuntime
);
const packageRoot = dirname(packageJsonPath);
const sourceFile = Bun.file(join(packageRoot, "src/ui/useDeviceStream.ts"));
const clientFile = Bun.file(join(packageRoot, "public/client.js"));
const source = await sourceFile.text();
const client = await clientFile.text();

const requiredMarkers = ["hiveMicrophone", "hive:microphone-status"];
for (const marker of requiredMarkers) {
  if (!(source.includes(marker) && client.includes(marker))) {
    throw new Error(
      `stream-droid patch is incomplete: ${marker} must exist in source and public/client.js`
    );
  }
}

const expectedHashes = {
  client: [
    "afc24a7c99a91f283ecedd24a2c05481",
    "becdc1915b91c68e5cdde3fd2ec92159",
  ].join(""),
  source: [
    "5df50205d3633305bc7fe68df53b1383",
    "7041ae7d8686524608de5fb644747012",
  ].join(""),
};
const actualHashes = {
  client: new Bun.CryptoHasher("sha256")
    .update(await clientFile.arrayBuffer())
    .digest("hex"),
  source: new Bun.CryptoHasher("sha256")
    .update(await sourceFile.arrayBuffer())
    .digest("hex"),
};
if (
  actualHashes.client !== expectedHashes.client ||
  actualHashes.source !== expectedHashes.source
) {
  throw new Error(
    `stream-droid patched source/client hashes changed without synchronized patch output: ${JSON.stringify(actualHashes)}`
  );
}

console.log("stream-droid patched source and client are synchronized");
