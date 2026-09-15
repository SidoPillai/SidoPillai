import fs from "node:fs";

const username = "SidoPillai";
const token = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function replaceSection(readme, name, content) {
  const start = `<!-- AUTO:${name}:START -->`;
  const end = `<!-- AUTO:${name}:END -->`;

  if (!readme.includes(start) || !readme.includes(end)) {
    throw new Error(`README is missing ${name} markers: ${start} / ${end}`);
  }

  const regex = new RegExp(`${start}[\\s\\S]*?${end}`, "m");

  return readme.replace(regex, `${start}\n${content}\n${end}`);
}

const repos = await github(
  `/users/${username}/repos?per_page=100&type=owner&sort=updated`,
);

const relevantRepos = repos.filter(
  (repo) => !repo.fork && repo.name !== username && !repo.archived,
);

//
// Languages
//

const totals = {};

for (const repo of relevantRepos) {
  const languages = await github(`/repos/${username}/${repo.name}/languages`);

  for (const [language, bytes] of Object.entries(languages)) {
    totals[language] = (totals[language] ?? 0) + bytes;
  }
}

const totalBytes = Object.values(totals).reduce((sum, value) => sum + value, 0);

const topLanguages = Object.entries(totals)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);

const languageMarkdown = topLanguages
  .map(([language, bytes]) => {
    const percentage =
      totalBytes === 0 ? 0 : ((bytes / totalBytes) * 100).toFixed(1);

    return `**${language}** — ${percentage}%`;
  })
  .join("  \n");

//
// Projects
//

const recentProjects = relevantRepos
  .slice(0, 6)
  .map((repo) => {
    const language = repo.language ? ` · ${repo.language}` : "";

    const stars =
      repo.stargazers_count > 0 ? ` · ⭐ ${repo.stargazers_count}` : "";

    const description = repo.description ? `\n${repo.description}` : "";

    return `### [${repo.name}](${repo.html_url})${language}${stars}${description}`;
  })
  .join("\n\n");

//
// Stats
//

const stars = relevantRepos.reduce(
  (sum, repo) => sum + repo.stargazers_count,
  0,
);

const forks = relevantRepos.reduce((sum, repo) => sum + repo.forks_count, 0);

const statsMarkdown = [
  `**${relevantRepos.length}** public repositories`,
  `**${stars}** stars received`,
  `**${forks}** forks`,
].join(" · ");

//
// Update README
//

let readme = fs.readFileSync("README.md", "utf8");

readme = replaceSection(readme, "STATS", statsMarkdown);

readme = replaceSection(readme, "LANGUAGES", languageMarkdown);

readme = replaceSection(readme, "PROJECTS", recentProjects);

fs.writeFileSync("README.md", readme);

console.log("Profile README updated.");
