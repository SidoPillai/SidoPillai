import fs from "node:fs";

const USERNAME = "SidoPillai";
const README_PATH = "README.md";

const RECENT_PROJECT_LIMIT = 5;
const POPULAR_PROJECT_LIMIT = 5;
const LANGUAGE_LIMIT = 8;
const LANGUAGE_BAR_LENGTH = 18;

const token = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${USERNAME}-profile-generator`,
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

/**
 * GitHub API request.
 */
async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers,
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `GitHub API request failed\n` +
        `Path: ${path}\n` +
        `Status: ${response.status}\n` +
        `${body}`,
    );
  }

  return response.json();
}

/**
 * Retrieve all public repositories owned by the user.
 */
async function getRepositories() {
  const repositories = [];

  let page = 1;

  while (true) {
    const result = await github(
      `/users/${USERNAME}/repos` +
        `?type=owner` +
        `&sort=pushed` +
        `&direction=desc` +
        `&per_page=100` +
        `&page=${page}`,
    );

    repositories.push(...result);

    if (result.length < 100) {
      break;
    }

    page++;
  }

  return repositories;
}

/**
 * Replace one generated section in README.md.
 */
function replaceSection(readme, name, content) {
  const start = `<!-- AUTO:${name}:START -->`;
  const end = `<!-- AUTO:${name}:END -->`;

  if (!readme.includes(start) || !readme.includes(end)) {
    throw new Error(
      `README.md is missing required markers:\n` + `${start}\n` + `${end}`,
    );
  }

  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end, startIndex);

  if (endIndex === -1) {
    throw new Error(`Unable to find closing marker for ${name}`);
  }

  const before = readme.slice(0, startIndex + start.length);
  const after = readme.slice(endIndex);

  return `${before}\n${content}\n${after}`;
}

/**
 * Escape Markdown table content.
 */
function escapeMarkdown(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Keep the profile repository itself, forks, and archived projects out
 * of the generated project statistics.
 */
function filterRepositories(repositories) {
  return repositories.filter(
    (repo) => repo.name !== USERNAME && !repo.fork && !repo.archived,
  );
}

/**
 * Build "Recent Projects".
 *
 * Since the GitHub API request is sorted by pushed date, the first
 * repositories represent the most recently active projects.
 */
function buildRecentProjects(repositories) {
  const recent = repositories.slice(0, RECENT_PROJECT_LIMIT);

  if (recent.length === 0) {
    return "_No public projects found._";
  }

  const rows = recent.map((repo) => {
    const name = `[${escapeMarkdown(repo.name)}](${repo.html_url})`;
    const description = escapeMarkdown(repo.description) || "—";
    const language = escapeMarkdown(repo.language) || "—";

    return `| ${name} | ${description} | ${language} |`;
  });

  return [
    "| Project | Description | Language |",
    "| :-- | :-- | :-- |",
    ...rows,
  ].join("\n");
}

/**
 * Build "Most Popular".
 *
 * Repositories are ranked by stars first and forks second.
 */
function buildPopularProjects(repositories) {
  const popular = [...repositories]
    .sort((a, b) => {
      if (b.stargazers_count !== a.stargazers_count) {
        return b.stargazers_count - a.stargazers_count;
      }

      return b.forks_count - a.forks_count;
    })
    .slice(0, POPULAR_PROJECT_LIMIT);

  if (popular.length === 0) {
    return "_No public projects found._";
  }

  const rows = popular.map((repo) => {
    const name = `[${escapeMarkdown(repo.name)}](${repo.html_url})`;
    const language = escapeMarkdown(repo.language) || "—";

    return (
      `| ${name} | ${repo.stargazers_count} | ` +
      `${repo.forks_count} | ${language} |`
    );
  });

  return [
    "| Project | Stars | Forks | Language |",
    "| :-- | --: | --: | :-- |",
    ...rows,
  ].join("\n");
}

/**
 * Fetch GitHub Linguist statistics for every repository.
 */
async function getLanguageTotals(repositories) {
  const totals = {};

  const results = await Promise.all(
    repositories.map(async (repo) => {
      try {
        return await github(
          `/repos/${USERNAME}/${encodeURIComponent(repo.name)}/languages`,
        );
      } catch (error) {
        console.warn(
          `Unable to retrieve languages for ${repo.name}:`,
          error.message,
        );

        return {};
      }
    }),
  );

  for (const languages of results) {
    for (const [language, bytes] of Object.entries(languages)) {
      totals[language] = (totals[language] ?? 0) + bytes;
    }
  }

  return totals;
}

/**
 * Build "Languages".
 */
function buildLanguages(languageTotals) {
  const entries = Object.entries(languageTotals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return "_No language data available._";
  }

  const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

  const topLanguages = entries.slice(0, LANGUAGE_LIMIT);

  const rows = topLanguages.map(([language, bytes]) => {
    const percentage = (bytes / totalBytes) * 100;

    const filled = Math.round((percentage / 100) * LANGUAGE_BAR_LENGTH);

    const bar = "█".repeat(filled) + "░".repeat(LANGUAGE_BAR_LENGTH - filled);

    return (
      `| **${escapeMarkdown(language)}** | ` +
      `\`${bar}\` | ${percentage.toFixed(1)}% |`
    );
  });

  return [
    "| Language | Distribution | Share |",
    "| :-- | :-- | --: |",
    ...rows,
  ].join("\n");
}

/**
 * Generate README.
 */
async function main() {
  console.log(`Generating GitHub profile for ${USERNAME}...`);

  const allRepositories = await getRepositories();
  const repositories = filterRepositories(allRepositories);

  console.log(`Found ${repositories.length} eligible public repositories.`);

  const recentProjects = buildRecentProjects(repositories);
  const popularProjects = buildPopularProjects(repositories);

  console.log("Fetching language statistics...");

  const languageTotals = await getLanguageTotals(repositories);

  const languages = buildLanguages(languageTotals);

  let readme = fs.readFileSync(README_PATH, "utf8");

  readme = replaceSection(readme, "PROJECTS", recentProjects);

  readme = replaceSection(readme, "POPULAR", popularProjects);

  readme = replaceSection(readme, "LANGUAGES", languages);

  fs.writeFileSync(README_PATH, readme);

  console.log("README.md updated successfully.");
}

main().catch((error) => {
  console.error("\nProfile generation failed:");
  console.error(error);

  process.exit(1);
});
