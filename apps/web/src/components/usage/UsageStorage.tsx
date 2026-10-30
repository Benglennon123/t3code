import type { EnvironmentId, WorktreeStorage, WorktreeStorageEntry } from "@t3tools/contracts";
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { figureClass, Metric } from "./UsageMetric";
import { UsageShareBar } from "./UsageShareBar";

export interface StorageEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly supported: boolean;
}

const WORKTREE_COLOR = "var(--primary)";
const OTHER_COLOR = "color-mix(in oklab, var(--contrast-foreground) 28%, var(--background))";
const FREE_COLOR = "color-mix(in oklab, var(--contrast-foreground) 8%, var(--background))";

export function worktreeStorageQuery(environmentId: EnvironmentId) {
  return serverEnvironment.worktreeStorage({ environmentId, input: {} });
}

export function UsageStorageSection({
  environments,
}: {
  readonly environments: readonly StorageEnvironment[];
}) {
  return (
    <div className="flex flex-col gap-12">
      {environments.map((environment) =>
        environment.supported ? (
          <EnvironmentStorage
            key={environment.environmentId}
            environment={environment}
            showLabel={environments.length > 1}
          />
        ) : (
          <p key={environment.environmentId} className="text-sm text-muted-foreground">
            {environment.label}: update this server to see worktree storage.
          </p>
        ),
      )}
    </div>
  );
}

function EnvironmentStorage({
  environment,
  showLabel,
}: {
  readonly environment: StorageEnvironment;
  readonly showLabel: boolean;
}) {
  const query = useEnvironmentQuery(worktreeStorageQuery(environment.environmentId));
  const storage = query.data;
  if (storage === null) {
    return query.error ? (
      <p className="text-sm text-muted-foreground">
        {showLabel ? `${environment.label}: ` : null}
        {query.error}
      </p>
    ) : (
      <StorageSkeleton />
    );
  }
  return (
    <StorageOverview
      environment={environment}
      storage={storage}
      loading={query.isPending}
      showLabel={showLabel}
      onCleaned={query.refresh}
    />
  );
}

interface ProjectGroup {
  readonly key: string;
  readonly label: string;
  readonly project: ProjectFaviconProject | null;
  readonly worktrees: number;
  readonly bytes: number;
}

function StorageOverview({
  environment,
  storage,
  loading,
  showLabel,
  onCleaned,
}: {
  readonly environment: StorageEnvironment;
  readonly storage: WorktreeStorage;
  readonly loading: boolean;
  readonly showLabel: boolean;
  readonly onCleaned: () => void;
}) {
  const projects = useProjects();
  const projectFor = (projectPath: string | null) =>
    projectPath === null
      ? undefined
      : projects.find(
          (project) =>
            project.environmentId === environment.environmentId &&
            project.workspaceRoot === projectPath,
        );
  const totalBytes = sumBytes(storage.worktrees);
  const unmeasured = storage.worktrees.filter((entry) => entry.bytes === null).length;
  const volume = storage.volume;
  const usedBytes = volume === null ? null : volume.totalBytes - volume.freeBytes;

  const groups = new Map<string, ProjectGroup>();
  for (const entry of storage.worktrees) {
    const key = entry.threadId === null ? "" : (entry.projectPath ?? "");
    const project = projectFor(key || null);
    const current = groups.get(key);
    groups.set(key, {
      key,
      label: key === "" ? "No thread" : (project?.title ?? basename(key)),
      project: project ?? null,
      worktrees: (current?.worktrees ?? 0) + 1,
      bytes: (current?.bytes ?? 0) + (entry.bytes ?? 0),
    });
  }
  const projectRows = [...groups.values()].toSorted((left, right) => right.bytes - left.bytes);
  const rows = storage.worktrees.toSorted(
    (left, right) => (right.bytes ?? -1) - (left.bytes ?? -1),
  );
  const peak = rows[0]?.bytes ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {showLabel ? (
        <h2 className="text-sm font-medium text-foreground">{environment.label}</h2>
      ) : null}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span
              className={cn(
                "text-4xl font-semibold text-foreground tabular-nums",
                figureClass(loading),
              )}
            >
              {formatBytes(totalBytes)}
            </span>
            <span className={cn("text-xs text-muted-foreground", figureClass(loading))}>
              {storage.worktrees.length} {storage.worktrees.length === 1 ? "worktree" : "worktrees"}
              {volume === null
                ? null
                : ` · ${formatPercent(totalBytes / volume.totalBytes)} of disk`}
              {unmeasured > 0 ? ` · ${unmeasured} not measured` : null}
            </span>
          </div>

          <CleanupRow environment={environment} storage={storage} onCleaned={onCleaned} />

          {projectRows.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  {group.project === null ? (
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ProjectFavicon project={group.project} className="size-4 shrink-0" />
                  )}
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate">{group.label}</span>
                    <span className="shrink-0 text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {group.worktrees} {group.worktrees === 1 ? "worktree" : "worktrees"}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-sm font-medium text-foreground tabular-nums",
                    figureClass(loading),
                  )}
                >
                  {formatBytes(group.bytes)}
                </span>
              </div>
              <span className={cn("text-xs text-muted-foreground", figureClass(loading))}>
                {formatPercent(totalBytes > 0 ? group.bytes / totalBytes : 0)} of worktrees
              </span>
            </div>
          ))}
        </div>

        <div className={cn("flex min-w-0 flex-col gap-6", figureClass(loading))}>
          {volume === null || usedBytes === null ? (
            <p className="text-sm text-muted-foreground">Disk capacity is unavailable.</p>
          ) : (
            <>
              <UsageShareBar
                label="Disk"
                format={formatBytes}
                aside={
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(volume.totalBytes)}
                  </span>
                }
                segments={[
                  { label: "Worktrees", value: totalBytes, color: WORKTREE_COLOR },
                  {
                    label: "Everything else",
                    value: Math.max(0, usedBytes - totalBytes),
                    color: OTHER_COLOR,
                  },
                  { label: "Free", value: volume.freeBytes, color: FREE_COLOR },
                ]}
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-4">
                <Metric loading={loading} label="Capacity" value={formatBytes(volume.totalBytes)} />
                <Metric loading={loading} label="Used" value={formatBytes(usedBytes)} />
                <Metric loading={loading} label="Free" value={formatBytes(volume.freeBytes)} />
                <Metric
                  loading={loading}
                  label="Worktrees"
                  value={formatPercent(totalBytes / volume.totalBytes)}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-right text-xs text-muted-foreground">
              <th className="py-2 pr-3 text-left font-normal">#</th>
              <th className="w-full py-2 text-left font-normal">Worktree</th>
              <th className="hidden py-2 pl-6 text-left font-normal sm:table-cell">Project</th>
              <th className="hidden py-2 pl-6 font-normal sm:table-cell">Share</th>
              <th className="py-2 pl-6 font-normal">Size</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No worktrees on this machine.
                </td>
              </tr>
            ) : (
              rows.map((entry, index) => (
                <WorktreeRow
                  key={entry.path}
                  index={index}
                  environmentId={environment.environmentId}
                  entry={entry}
                  projectLabel={
                    entry.threadId === null
                      ? "No thread"
                      : (groups.get(entry.projectPath ?? "")?.label ?? "")
                  }
                  totalBytes={totalBytes}
                  peak={peak}
                  loading={loading}
                />
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function WorktreeRow({
  index,
  environmentId,
  entry,
  projectLabel,
  totalBytes,
  peak,
  loading,
}: {
  readonly index: number;
  readonly environmentId: EnvironmentId;
  readonly entry: WorktreeStorageEntry;
  readonly projectLabel: string;
  readonly totalBytes: number;
  readonly peak: number;
  readonly loading: boolean;
}) {
  const name = entry.threadTitle ?? basename(entry.path);
  const hasBar = entry.bytes !== null && entry.bytes > 0 && peak > 0;
  return (
    <tr className="relative border-b border-border/50 text-right whitespace-nowrap text-muted-foreground tabular-nums transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50">
      <td className="py-2.5 pr-3 text-left text-xs">{index + 1}</td>
      <td className="max-w-0 py-2.5 text-left">
        {entry.threadId === null ? (
          <span className={cn("block truncate text-foreground", !hasBar && "py-1")}>{name}</span>
        ) : (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: entry.threadId }}
            className={cn(
              "block truncate text-foreground outline-none after:absolute after:inset-0",
              !hasBar && "py-1",
            )}
          >
            {name}
          </Link>
        )}
        {hasBar ? (
          <div aria-hidden className={cn("mt-1.5 h-0.5 max-w-48", figureClass(loading))}>
            <div
              className="h-full rounded-full"
              style={{
                width: `max(0.5rem, ${(entry.bytes! / peak) * 100}%)`,
                backgroundColor: WORKTREE_COLOR,
              }}
            />
          </div>
        ) : null}
      </td>
      <td className="hidden py-2.5 pl-6 text-left sm:table-cell">{projectLabel}</td>
      <td className={cn("hidden py-2.5 pl-6 sm:table-cell", figureClass(loading))}>
        {entry.bytes === null || totalBytes === 0 ? "" : formatPercent(entry.bytes / totalBytes)}
      </td>
      <td className={cn("py-2.5 pl-6 text-foreground", figureClass(loading))}>
        {entry.bytes === null ? (
          <span className="text-muted-foreground">Not measured</span>
        ) : (
          formatBytes(entry.bytes)
        )}
      </td>
    </tr>
  );
}

function CleanupRow({
  environment,
  storage,
  onCleaned,
}: {
  readonly environment: StorageEnvironment;
  readonly storage: WorktreeStorage;
  readonly onCleaned: () => void;
}) {
  const allowed = useAtomValue(
    serverEnvironment.runStorageCleanup.permissionAtom(environment.environmentId),
  );
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const [pending, setPending] = useState(false);
  const cleanUp = async () => {
    setPending(true);
    const result = await run({ environmentId: environment.environmentId, input: {} });
    setPending(false);
    if (result._tag !== "Success") return;
    const failed = result.value.counts.failed;
    toastManager.add({
      type: failed > 0 ? "warning" : "success",
      title: `Freed ${formatBytes(result.value.bytesFreed)} on ${environment.label}`,
      description: `${result.value.counts.removed} removed, ${result.value.counts.kept} kept${failed > 0 ? `, ${failed} failed` : ""}.`,
    });
    onCleaned();
  };
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      {storage.worktreeCleanupEnabled ? (
        <span>Cleanup keeps worktrees with changes.</span>
      ) : (
        <span>
          Cleanup rules are off.{" "}
          <Link to="/settings/worktrees" className="text-foreground hover:underline">
            Set up
          </Link>
        </span>
      )}
      <Button
        variant="outline"
        size="xs"
        disabled={pending || !allowed || !storage.worktreeCleanupEnabled}
        onClick={() => void cleanUp()}
      >
        {pending ? "Cleaning…" : "Clean up"}
      </Button>
    </div>
  );
}

function StorageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function sumBytes(entries: ReadonlyArray<WorktreeStorageEntry>): number {
  return entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
}

function basename(target: string): string {
  return target.split(/[\\/]/).findLast((part) => part.length > 0) ?? target;
}
