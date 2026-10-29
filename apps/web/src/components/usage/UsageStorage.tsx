import type { EnvironmentId, WorktreeStorage, WorktreeStorageEntry } from "@t3tools/contracts";
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
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
    <div className="flex flex-col gap-10">
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
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <section className={cn("flex flex-col gap-6", query.isPending && "opacity-60")}>
      {showLabel ? (
        <h2 className="text-sm font-medium text-foreground">{environment.label}</h2>
      ) : null}
      <StorageSummary storage={storage} environment={environment} onCleaned={query.refresh} />
      <StorageBreakdown environmentId={environment.environmentId} storage={storage} />
    </section>
  );
}

function StorageSummary({
  storage,
  environment,
  onCleaned,
}: {
  readonly storage: WorktreeStorage;
  readonly environment: StorageEnvironment;
  readonly onCleaned: () => void;
}) {
  const worktreeBytes = sumBytes(storage.worktrees);
  const unmeasured = storage.worktrees.filter((entry) => entry.bytes === null).length;
  const volume = storage.volume;
  const usedBytes = volume === null ? 0 : volume.totalBytes - volume.freeBytes;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <span className="text-4xl font-semibold text-foreground tabular-nums">
          {formatBytes(worktreeBytes)}
        </span>
        <span className="text-xs text-muted-foreground">
          {storage.worktrees.length} {storage.worktrees.length === 1 ? "worktree" : "worktrees"}
          {volume === null
            ? null
            : ` · ${formatPercent(worktreeBytes / volume.totalBytes)} of ${formatBytes(volume.totalBytes)} disk`}
          {unmeasured > 0 ? ` · ${unmeasured} not measured` : null}
        </span>
        <CleanupButton environment={environment} storage={storage} onCleaned={onCleaned} />
      </div>
      {volume === null ? null : (
        <UsageShareBar
          label="Disk"
          format={formatBytes}
          aside={
            <span className="text-xs text-muted-foreground">
              {formatBytes(volume.freeBytes)} free
            </span>
          }
          segments={[
            { label: "Worktrees", value: worktreeBytes, color: WORKTREE_COLOR },
            {
              label: "Everything else",
              value: Math.max(0, usedBytes - worktreeBytes),
              color: OTHER_COLOR,
            },
            { label: "Free", value: volume.freeBytes, color: FREE_COLOR },
          ]}
        />
      )}
    </div>
  );
}

function CleanupButton({
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
    <div className="mt-4 flex flex-col items-start gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !allowed || !storage.worktreeCleanupEnabled}
        onClick={() => void cleanUp()}
      >
        {pending ? "Cleaning up…" : "Clean up now"}
      </Button>
      <span className="text-xs text-muted-foreground">
        {storage.worktreeCleanupEnabled ? (
          "Runs your cleanup rules. Worktrees with changes or open terminals are kept."
        ) : (
          <>
            No worktree cleanup rules are on.{" "}
            <Link to="/settings/storage" className="underline underline-offset-2">
              Set them up
            </Link>
          </>
        )}
      </span>
    </div>
  );
}

function StorageBreakdown({
  environmentId,
  storage,
}: {
  readonly environmentId: EnvironmentId;
  readonly storage: WorktreeStorage;
}) {
  const byProject = new Map<string | null, WorktreeStorageEntry[]>();
  for (const entry of storage.worktrees) {
    const key = entry.threadId === null ? null : entry.projectPath;
    byProject.set(key, [...(byProject.get(key) ?? []), entry]);
  }
  const groups = [...byProject]
    .map(([projectPath, entries]) => ({
      projectPath,
      entries: entries.toSorted((left, right) => (right.bytes ?? -1) - (left.bytes ?? -1)),
      bytes: sumBytes(entries),
    }))
    .toSorted((left, right) => right.bytes - left.bytes);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No worktrees on this machine.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <h2 className="mb-2 text-sm font-medium text-foreground">By project</h2>
      {groups.map((group) => (
        <Collapsible key={group.projectPath ?? "orphans"}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md py-1.5 text-start text-sm text-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-panel-open:[&_svg]:rotate-90">
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {group.projectPath === null ? "No thread" : basename(group.projectPath)}
              <span className="ms-2 text-xs text-muted-foreground">{group.entries.length}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatBytes(group.bytes)}</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul className="mb-2 ms-5.5 flex flex-col border-s ps-3">
              {group.entries.map((entry) => (
                <WorktreeRow key={entry.path} environmentId={environmentId} entry={entry} />
              ))}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      ))}
    </div>
  );
}

function WorktreeRow({
  environmentId,
  entry,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: WorktreeStorageEntry;
}) {
  const name = entry.threadTitle ?? basename(entry.path);
  return (
    <li className="flex items-baseline gap-3 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate">
        {entry.threadId === null ? (
          <span className="text-muted-foreground">{name}</span>
        ) : (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: entry.threadId }}
            className="text-foreground hover:underline"
          >
            {name}
          </Link>
        )}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {entry.bytes === null ? "Not measured" : formatBytes(entry.bytes)}
      </span>
    </li>
  );
}

function sumBytes(entries: ReadonlyArray<WorktreeStorageEntry>): number {
  return entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
}

function basename(target: string): string {
  return target.split(/[\\/]/).findLast((part) => part.length > 0) ?? target;
}
