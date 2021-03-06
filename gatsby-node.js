// A light weight interface for running git commands in any node.js application.  npmjs.com/package/simple-git
const Git = require("simple-git/promise");

// Match files using the patterns the shell uses. npmjs.com/package/fast-glob
const fastGlob = require("fast-glob");

// Node.js file system module allows you to work with the file system
const fs = require("fs");

// The Gatsby source filesystem plugin
const { createFileNode } = require("gatsby-source-filesystem/create-file-node");

// npmjs.com/package/git-url-parse
const GitUrlParse = require("git-url-parse");


//trim() removes whitespace from both ends of a string.  developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/Trim
async function isAlreadyCloned(remote, path) {
  const existingRemote = await Git(path).listRemote(["--get-url"]);
  return existingRemote.trim() == remote.trim();
}

async function getTargetBranch(repo, branch) {
  if (typeof branch == `string`) {
    return `origin/${branch}`;
  } else {
    return repo.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  }
}

async function getRepo(path, remote, branch) {
  // If the directory doesn't exist or is empty, clone. This will be the case if
  // our config has changed because Gatsby trashes the cache dir automatically
  // in that case.
  if (!fs.existsSync(path) || fs.readdirSync(path).length === 0) {
    let opts = [`--depth`, `1`];
    if (typeof branch == `string`) {
      opts.push(`--branch`, branch);
    }
    await Git().clone(remote, path, opts);
    return Git(path);
  } else if (await isAlreadyCloned(remote, path)) {
    const repo = await Git(path);
    const target = await getTargetBranch(repo, branch);
    // Refresh our shallow clone with the latest commit.
    await repo
      .fetch([`--depth`, `1`])
      .then(() => repo.reset([`--hard`, target]));
    return repo;
  } else {
    throw new Error(`Can't clone to target destination: ${localPath}`);
  }
}

exports.sourceNodes = async (
  {
    actions: { createNode },
    store,
    createNodeId,
    createContentDigest,
    reporter
  },
  { name, remote, branch, patterns = `**` }
) => {
  const programDir = store.getState().program.directory;
  const localPath = require("path").join(
    programDir,
    `.cache`,
    `gatsby-source-git`,
    name
  );
  const parsedRemote = GitUrlParse(remote);

  let repo;
  try {
    repo = await getRepo(localPath, remote, branch);
  } catch (e) {
    return reporter.error(e);
  }

  parsedRemote.git_suffix = false;
  parsedRemote.webLink = parsedRemote.toString("https");
  delete parsedRemote.git_suffix;
  let ref = await repo.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
  parsedRemote.ref = ref.trim();

  const repoFiles = await fastGlob(patterns, {
    cwd: localPath,
    absolute: true
  });

  const remoteId = createNodeId(`git-remote-${name}`);

  // Create a single graph node for this git remote.
  // Filenodes sourced from it will get a field pointing back to it.
  await createNode(
    Object.assign(parsedRemote, {
      id: remoteId,
      sourceInstanceName: name,
      parent: null,
      children: [],
      internal: {
        type: `GitRemote`,
        content: JSON.stringify(parsedRemote),
        contentDigest: createContentDigest(parsedRemote)
      }
    })
  );

  const createAndProcessNode = path => {
    return createFileNode(path, createNodeId, {
      name: name,
      path: localPath
    }).then(fileNode => {
      // Add a link to the git remote node
      fileNode.gitRemote___NODE = remoteId;
      // Then create the node, as if it were created by the gatsby-source
      // filesystem plugin.
      return createNode(fileNode, {
        name: `gatsby-source-filesystem`
      });
    });
  };

  return Promise.all(repoFiles.map(createAndProcessNode));
};

exports.onCreateNode;
