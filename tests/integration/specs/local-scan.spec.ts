import { test, expect } from "@playwright/test";
import { createTestLibrary } from "../helpers/generate-mp3";
import { createMockInitScript, type MockFileData } from "../helpers/browser-mocks";

const LIBRARY_PATH = "/test-music";

/**
 * Pre-populate <root>/.selftify/root.json with scanStatus "done"
 * so AutoLocalScan does NOT auto-trigger.
 * The test manually triggers scanning from LocalPage.
 */
function buildConfigFile(root: string): { path: string; bytes: number[] } {
  const config = {
    version: 1,
    libraryName: "Test Library",
    createdAt: Date.now(),
    lastScanAt: null,
    scanStatus: "done",
    songCount: 0,
    artistCount: 0,
    albumCount: 0,
  };
  const encoder = new TextEncoder();
  const bytes = encoder.encode(JSON.stringify(config));
  return {
    path: root + "/.selftify/root.json",
    bytes: Array.from(bytes),
  };
}

test.describe("Local library scan", () => {
  let library: ReturnType<typeof createTestLibrary>;

  test.beforeAll(() => {
    library = createTestLibrary(LIBRARY_PATH);
  });

  test.beforeEach(async ({ page }) => {
    const files: MockFileData = [
      ...library.tracks.map((t) => ({
        path: t.filePath,
        bytes: Array.from(t.bytes),
      })),
      buildConfigFile(LIBRARY_PATH),
    ];

    const initScript = createMockInitScript(LIBRARY_PATH, files);
    await page.addInitScript(initScript);
    await page.goto("/");
  });

  test("scans a local library and shows songs in the UI", async ({ page }) => {
    await page.waitForSelector("nav", { timeout: 15_000 });

    // Navigate to Local page via sidebar
    await page.locator('nav button:has-text("Local")').click();

    // Click Scan button
    const scanBtn = page.locator("button:has-text('Scan')");
    await expect(scanBtn).toBeVisible({ timeout: 15_000 });
    await scanBtn.click();

    // Wait for scan completion — either status message or Rescan button
    await page.waitForFunction(
      () => document.body.textContent?.includes("Local library indexed"),
      { timeout: 90_000 },
    );

    // Wait for the song list to render
    await page.waitForSelector("text=First Track", { timeout: 30_000 });
    await page.waitForSelector("text=Second Track", { timeout: 10_000 });

    // Verify song names, artist, and album appear
    const bodyText = await page.textContent("body") || "";
    expect(bodyText).toContain("First Track");
    expect(bodyText).toContain("Second Track");
    expect(bodyText).toContain("TestArtist");
    expect(bodyText).toContain("TestAlbum");

    // Verify scan stats appear in subtitle
    expect(bodyText).toContain("2 songs");
    expect(bodyText).toContain("1 artists");
    expect(bodyText).toContain("1 albums");
  });

  test("creates album entry with correct metadata", async ({ page }) => {
    await page.waitForSelector("nav", { timeout: 15_000 });
    await page.locator('nav button:has-text("Local")').click();

    const scanBtn = page.locator("button:has-text('Scan')");
    await expect(scanBtn).toBeVisible({ timeout: 15_000 });
    await scanBtn.click();

    await page.waitForFunction(
      () => document.body.textContent?.includes("Local library indexed"),
      { timeout: 90_000 },
    );

    // Wait for songs to load
    await page.waitForSelector("text=First Track", { timeout: 30_000 });

    // Switch to Albums tab
    const albumsTab = page.locator('button:has-text("Albums")');
    await expect(albumsTab).toBeVisible({ timeout: 10_000 });
    await albumsTab.click();

    // Verify album card appears with name and year
    await page.waitForSelector("text=TestAlbum", { timeout: 10_000 });

    const bodyText = await page.textContent("body") || "";
    expect(bodyText).toContain("TestAlbum");
    expect(bodyText).toContain("2024");
  });

  test("creates artist entry", async ({ page }) => {
    await page.waitForSelector("nav", { timeout: 15_000 });
    await page.locator('nav button:has-text("Local")').click();

    const scanBtn = page.locator("button:has-text('Scan')");
    await expect(scanBtn).toBeVisible({ timeout: 15_000 });
    await scanBtn.click();

    await page.waitForFunction(
      () => document.body.textContent?.includes("Local library indexed"),
      { timeout: 90_000 },
    );

    await page.waitForSelector("text=First Track", { timeout: 30_000 });

    // Switch to Artists tab
    const artistsTab = page.locator('button:has-text("Artists")');
    await expect(artistsTab).toBeVisible({ timeout: 10_000 });
    await artistsTab.click();

    await page.waitForSelector("text=TestArtist", { timeout: 10_000 });

    const bodyText = await page.textContent("body") || "";
    expect(bodyText).toContain("TestArtist");
  });

  test("genres tab shows Rock genre", async ({ page }) => {
    await page.waitForSelector("nav", { timeout: 15_000 });
    await page.locator('nav button:has-text("Local")').click();

    const scanBtn = page.locator("button:has-text('Scan')");
    await expect(scanBtn).toBeVisible({ timeout: 15_000 });
    await scanBtn.click();

    await page.waitForFunction(
      () => document.body.textContent?.includes("Local library indexed"),
      { timeout: 90_000 },
    );

    await page.waitForSelector("text=First Track", { timeout: 30_000 });

    // Switch to Genres tab
    const genresTab = page.locator('button:has-text("Genres")');
    await expect(genresTab).toBeVisible({ timeout: 10_000 });
    await genresTab.click();

    await page.waitForSelector("text=Rock", { timeout: 10_000 });
  });
});
