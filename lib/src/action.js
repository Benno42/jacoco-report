"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.action = action;
/* eslint-disable @typescript-eslint/no-explicit-any */
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const processors_1 = require("xml2js/lib/processors");
const glob = __importStar(require("@actions/glob"));
const process_1 = require("./process");
const render_1 = require("./render");
const util_1 = require("./util");
async function action() {
    let continueOnError = true;
    try {
        const token = core.getInput('token');
        if (!token) {
            core.setFailed("'token' is missing");
            return;
        }
        const pathsString = core.getInput('paths');
        if (!pathsString) {
            core.setFailed("'paths' is missing");
            return;
        }
        const reportPaths = pathsString.split(',');
        const minCoverageOverall = parseFloat(core.getInput('min-coverage-overall'));
        const minCoverageChangedFiles = parseFloat(core.getInput('min-coverage-changed-files'));
        const title = core.getInput('title');
        const updateComment = (0, processors_1.parseBooleans)(core.getInput('update-comment'));
        if (updateComment) {
            if (!title) {
                core.info("'title' is not set. 'update-comment' does not work without 'title'");
            }
        }
        const skipIfNoChanges = (0, processors_1.parseBooleans)(core.getInput('skip-if-no-changes'));
        const passEmoji = core.getInput('pass-emoji');
        const failEmoji = core.getInput('fail-emoji');
        // Add the new force-multimodule parameter
        const forceMultimodule = (0, processors_1.parseBooleans)(core.getInput('force-multimodule'));
        continueOnError = (0, processors_1.parseBooleans)(core.getInput('continue-on-error'));
        const debugMode = (0, processors_1.parseBooleans)(core.getInput('debug-mode'));
        const event = github.context.eventName;
        core.info(`Event is ${event}`);
        if (debugMode) {
            core.info(`passEmoji: ${passEmoji}`);
            core.info(`failEmoji: ${failEmoji}`);
        }
        const commentType = core.getInput('comment-type');
        if (debugMode) {
            core.info(`commentType: ${commentType}`);
        }
        if (!isValidCommentType(commentType)) {
            core.setFailed(`'comment-type' ${commentType} is invalid`);
        }
        const compareWithBaseBranch = (0, processors_1.parseBooleans)(core.getInput('compare-with-base-branch'));
        let prNumber = Number(core.getInput('pr-number')) || undefined;
        const client = github.getOctokit(token);
        const sha = github.context.sha;
        let base = sha;
        let head = sha;
        switch (event) {
            case 'pull_request':
            case 'pull_request_target':
                base = github.context.payload.pull_request?.base.sha;
                head = github.context.payload.pull_request?.head.sha;
                prNumber = prNumber ?? github.context.payload.pull_request?.number;
                break;
            case 'push':
            case 'workflow_dispatch':
                const shaResult = await determineShasForPushOrDispatch(event, client, sha, compareWithBaseBranch);
                base = shaResult.base;
                head = shaResult.head;
                break;
            case 'schedule':
                prNumber =
                    prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha));
                break;
            case 'workflow_run':
                const pullRequests = github.context.payload?.workflow_run?.pull_requests ?? [];
                if (pullRequests.length !== 0) {
                    base = pullRequests[0]?.base?.sha;
                    head = pullRequests[0]?.head?.sha;
                    prNumber = prNumber ?? pullRequests[0]?.number;
                }
                else {
                    prNumber =
                        prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha));
                }
                break;
            default:
                core.setFailed(`The event ${github.context.eventName} is not supported.`);
                return;
        }
        core.info(`base sha: ${base}`);
        core.info(`head sha: ${head}`);
        if (debugMode)
            core.info(`context: ${(0, util_1.debug)(github.context)}`);
        if (debugMode)
            core.info(`reportPaths: ${reportPaths}`);
        const changedFiles = await getChangedFiles(base, head, client, debugMode);
        if (debugMode)
            core.info(`changedFiles: ${(0, util_1.debug)(changedFiles)}`);
        const reportsJsonAsync = getJsonReports(reportPaths, debugMode);
        const reports = await reportsJsonAsync;
        const project = (0, process_1.getProjectCoverage)(reports, changedFiles, forceMultimodule);
        if (debugMode)
            core.info(`project: ${(0, util_1.debug)(project)}`);
        core.setOutput('coverage-overall', project.overall ? parseFloat(project.overall.percentage.toFixed(2)) : 100);
        core.setOutput('coverage-changed-files', parseFloat(project['coverage-changed-files'].toFixed(2)));
        const skip = skipIfNoChanges && project.modules.length === 0;
        if (debugMode)
            core.info(`skip: ${skip}`);
        if (debugMode)
            core.info(`prNumber: ${prNumber}`);
        if (!skip) {
            const emoji = {
                pass: passEmoji,
                fail: failEmoji,
            };
            const titleFormatted = (0, render_1.getTitle)(title);
            const bodyFormatted = (0, render_1.getPRComment)(project, {
                overall: minCoverageOverall,
                changed: minCoverageChangedFiles,
            }, title, emoji);
            switch (commentType) {
                case 'pr_comment':
                    await addComment(prNumber, updateComment, titleFormatted, bodyFormatted, client, debugMode);
                    break;
                case 'summary':
                    await addWorkflowSummary(bodyFormatted);
                    break;
                case 'both':
                    await addComment(prNumber, updateComment, titleFormatted, bodyFormatted, client, debugMode);
                    await addWorkflowSummary(bodyFormatted);
                    break;
            }
        }
    }
    catch (error) {
        if (error instanceof Error) {
            if (continueOnError) {
                core.error(error);
            }
            else {
                core.setFailed(error);
            }
        }
    }
}
/**
 * Finds an open pull request associated with the given branch reference.
 *
 * This function searches for an open PR where the head branch matches the provided branch reference.
 * It's used to determine the base branch for comparison when analyzing code coverage changes.
 *
 * @param client - GitHub API client
 * @param branchRef - Branch reference (e.g., 'refs/heads/feature-branch')
 * @returns The pull request object if found, null otherwise
 */
async function getPullRequestForBranch(client, branchRef) {
    const branchName = branchRef.replace('refs/heads/', '');
    const response = await client.rest.pulls.list({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        state: 'open',
        head: `${github.context.repo.owner}:${branchName}`,
    });
    return response.data.length > 0 ? response.data[0] : null;
}
/**
 * Determines the base SHA for workflow_dispatch events by finding the parent commit
 * of the current SHA.
 *
 * @param client - GitHub API client
 * @param sha - Current commit SHA
 * @returns The parent commit SHA or the current SHA if parent cannot be determined
 */
async function determineBaseShaForWorkflowDispatch(client, sha) {
    try {
        // Try to get the parent commit
        const commitResponse = await client.rest.repos.getCommit({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            ref: sha,
        });
        if (commitResponse.data.parents && commitResponse.data.parents.length > 0) {
            return commitResponse.data.parents[0].sha;
        }
    }
    catch (error) {
        core.warning(`Failed to determine parent commit: ${error}`);
    }
    // Return the current SHA if we can't determine parent
    return sha;
}
/**
 * Determines the base and head SHAs for push and workflow_dispatch events.
 * Ensures consistent handling between these event types.
 *
 * For push events:
 * - If compareWithBaseBranch is true and a PR exists, uses PR's base and head
 * - Otherwise uses before/after from the push payload
 *
 * For workflow_dispatch events:
 * - If compareWithBaseBranch is true and a PR exists, uses PR's base and current SHA
 * - Otherwise uses parent commit as base and current SHA as head
 *
 * @param event - GitHub event name ('push', 'workflow_dispatch', etc.)
 * @param client - GitHub API client
 * @param sha - Current commit SHA
 * @param compareWithBaseBranch - Whether to compare with base branch or previous commit
 * @returns Object containing base and head SHAs for comparison
 */
async function determineShasForPushOrDispatch(event, client, sha, compareWithBaseBranch) {
    // Default values
    let base = sha;
    let head = sha;
    if (compareWithBaseBranch) {
        // Try to find associated PR
        const prForBranch = await getPullRequestForBranch(client, github.context.ref);
        if (prForBranch) {
            base = prForBranch.base.sha;
            head = event === 'push' ? github.context.payload.after : sha;
            return { base, head };
        }
    }
    // If no PR found or compareWithBaseBranch is false
    if (event === 'push') {
        // Use standard behavior for push
        base = github.context.payload.before;
        head = github.context.payload.after;
    }
    else if (event === 'workflow_dispatch') {
        // For workflow_dispatch, get parent commit
        base = await determineBaseShaForWorkflowDispatch(client, sha);
        head = sha;
    }
    return { base, head };
}
async function getJsonReports(xmlPaths, debugMode) {
    const globber = await glob.create(xmlPaths.join('\n'));
    const files = await globber.glob();
    if (debugMode)
        core.info(`Resolved files: ${files}`);
    return Promise.all(files.map(async (path) => {
        const reportXml = await fs.promises.readFile(path.trim(), 'utf-8');
        return await (0, util_1.parseToReport)(reportXml);
    }));
}
async function getChangedFiles(base, head, client, debugMode) {
    const response = await client.rest.repos.compareCommits({
        base,
        head,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    const changedFiles = [];
    const files = response.data.files ?? [];
    for (const file of files) {
        if (debugMode)
            core.info(`file: ${(0, util_1.debug)(file)}`);
        const changedFile = {
            filePath: file.filename,
            url: file.blob_url,
            lines: (0, util_1.getChangedLines)(file.patch),
        };
        changedFiles.push(changedFile);
    }
    return changedFiles;
}
async function addComment(prNumber, update, title, body, client, debugMode) {
    if (prNumber === undefined) {
        if (debugMode)
            core.info('prNumber not present');
        return;
    }
    let commentUpdated = false;
    if (debugMode)
        core.info(`update: ${update}`);
    if (debugMode)
        core.info(`title: ${title}`);
    if (debugMode)
        core.info(`JaCoCo Comment: ${body}`);
    if (update && title) {
        if (debugMode)
            core.info('Listing all comments');
        const comments = await client.rest.issues.listComments({
            issue_number: prNumber,
            ...github.context.repo,
        });
        const comment = comments.data.find((it) => it.body.startsWith(title));
        if (comment) {
            if (debugMode)
                core.info(`Updating existing comment: id=${comment.id} \n body=${comment.body}`);
            await client.rest.issues.updateComment({
                comment_id: comment.id,
                body,
                ...github.context.repo,
            });
            commentUpdated = true;
        }
    }
    if (!commentUpdated) {
        if (debugMode)
            core.info('Creating a new comment');
        await client.rest.issues.createComment({
            issue_number: prNumber,
            body,
            ...github.context.repo,
        });
    }
}
async function addWorkflowSummary(body) {
    await core.summary.addRaw(body, true).write();
}
const validCommentTypes = ['pr_comment', 'summary', 'both'];
const isValidCommentType = (value) => {
    return validCommentTypes.includes(value);
};
async function getPrNumberAssociatedWithCommit(client, commitSha) {
    const response = await client.rest.repos.listPullRequestsAssociatedWithCommit({
        commit_sha: commitSha,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    return response.data.length > 0 ? response.data[0].number : undefined;
}
