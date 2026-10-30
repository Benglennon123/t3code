import type { EnvironmentId, WorktreeStorage, WorktreeStorageEntry } from "@t3tools/contracts";
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { UsageShareBar } from "../usage/UsageShareBar";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

const WORKTREE_COLOR = "var(--primary)";
const OTHER_COLOR = "color-mix(in oklab, var(--contrast-foreground) 28%, var(--background))";
const FREE_COLOR = "color-mix(in oklab, var(--contrast-foreground) 8%, var(--background))";

interface StorageMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

function worktreeStorageQuery(environmentId: EnvironmentId) {
  return serverEnvironment.worktreeStorage({ environmentId, input: {} });
}

/** Read-only disk usage for the selected machines' worktrees. */
export function WorktreeStorageSection() {
  const { connectedEnvironments } = useSettingsScope();
  const machines = connectedEnvironments
    .filter(
      (environment) => environment.serverConfig?.environment.capabilities.worktreeStorage === true,
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
    }));
  if (machines.length === 0) return null;
  return (
    <>
      {machines.map((machine) => (
        <MachineStorage
          key={machine.environmentId}
          machine={machine}
          showLabel={machines.length > 1}
        />
      ))}
    </>
  );
}

function MachineStorage({
  machine,
  showLabel,
}: {
  readonly machine: StorageMachine;
  readonly showLabel: boolean;
}) {
  const query = useEnvironmentQuery(worktreeStorageQuery(machine.environmentId));
  const storage = query.data;
  const title = showLabel ? `Disk usage on ${machine.label}` : "Disk usage";
  return (
    <>
      <SettingsSection
        id={`worktree-storage-${machine.environmentId}`}
        title={title}
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Measure again"
            aria-busy={query.isPending}
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshIcon size="sm" refreshing={query.isPending} />
          </Button>
        }
      >
        {storage === null ? (
          query.error ? (
            <SettingsRow title="Couldn't measure worktrees" description={query.error} />
          ) : (
            <div className="flex flex-col gap-3 px-3 py-3 sm:px-4" aria-busy>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-2 w-full" />
            </div>
          )
        ) : (
          <StorageSummary machine={machine} storage={storage} onCleaned={query.refresh} />
        )}
      </SettingsSection>
      {storage !== null && storage.worktrees.length > 0 ? (
        <FoldedSettingsSection
          id={`worktree-storage-list-${machine.environmentId}`}
          title="Largest worktrees"
          headerPlacement="inside"
          summary={`${storage.worktrees.length} ${storage.worktrees.length === 1 ? "worktree" : "worktrees"}`}
        >
          {storage.worktrees
            .toSorted((left, right) => (right.bytes ?? -1) - (left.bytes ?? -1))
            .map((entry) => (
              <WorktreeRow key={entry.path} environmentId={machine.environmentId} entry={entry} />
            ))}
        </FoldedSettingsSection>
      ) : null}
    </>
  );
}

function StorageSummary({
  machine,
  storage,
  onCleaned,
}: {
  readonly machine: StorageMachine;
  readonly storage: WorktreeStorage;
  readonly onCleaned: () => void;
}) {
  const totalBytes = storage.worktrees.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  const unmeasured = storage.worktrees.filter((entry) => entry.bytes === null).length;
  const volume = storage.volume;
  return (
    <>
      <SettingsRow
        title={`${formatBytes(totalBytes)} in ${storage.worktrees.length} ${storage.worktrees.length === 1 ? "worktree" : "worktrees"}`}
        description={[
          volume === null
            ? "Disk capacity is unavailable."
            : `${formatPercent(totalBytes / volume.totalBytes)} of this machine's ${formatBytes(volume.totalBytes)} disk. ${formatBytes(volume.freeBytes)} free.`,
          unmeasured > 0 ? `${unmeasured} couldn't be measured.` : null,
          storage.worktreeCleanupEnabled
            ? "Cleanup keeps worktrees with changes or open terminals."
            : "Turn on a cleanup rule below to clean up from here.",
        ]
          .filter(Boolean)
          .join(" ")}
        control={<CleanupButton machine={machine} storage={storage} onCleaned={onCleaned} />}
      />
      {volume === null ? null : (
        <div className="px-3 pt-1 pb-4 sm:px-4">
          <UsageShareBar
            label="Disk"
            format={formatBytes}
            segments={[
              { label: "Worktrees", value: totalBytes, color: WORKTREE_COLOR },
              {
                label: "Everything else",
                value: Math.max(0, volume.totalBytes - volume.freeBytes - totalBytes),
                color: OTHER_COLOR,
              },
              { label: "Free", value: volume.freeBytes, color: FREE_COLOR },
            ]}
          />
        </div>
      )}
    </>
  );
}

function CleanupButton({
  machine,
  storage,
  onCleaned,
}: {
  readonly machine: StorageMachine;
  readonly storage: WorktreeStorage;
  readonly onCleaned: () => void;
}) {
  const allowed = useAtomValue(
    serverEnvironment.runStorageCleanup.permissionAtom(machine.environmentId),
  );
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const [pending, setPending] = useState(false);
  const cleanUp = async () => {
    setPending(true);
    const result = await run({ environmentId: machine.environmentId, input: {} });
    setPending(false);
    if (result._tag !== "Success") return;
    const failed = result.value.counts.failed;
    toastManager.add({
      type: failed > 0 ? "warning" : "success",
      title: `Freed ${formatBytes(result.value.bytesFreed)} on ${machine.label}`,
      description: `${result.value.counts.removed} removed, ${result.value.counts.kept} kept${failed > 0 ? `, ${failed} failed` : ""}.`,
    });
    onCleaned();
  };
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || !allowed || !storage.worktreeCleanupEnabled}
      onClick={() => void cleanUp()}
    >
      {pending ? "Cleaning up…" : "Clean up now"}
    </Button>
  );
}

function WorktreeRow({
  environmentId,
  entry,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: WorktreeStorageEntry;
}) {
  const folder = entry.path.split(/[\\/]/).findLast((part) => part.length > 0) ?? entry.path;
  const projects = useProjects();
  const project =
    projects.find(
      (candidate) =>
        candidate.environmentId === environmentId && candidate.workspaceRoot === entry.projectPath,
    )?.title ?? entry.projectPath?.split(/[\\/]/).findLast((part) => part.length > 0);
  return (
    <SettingsRow
      title={
        entry.threadId === null ? (
          <span className="wrap-anywhere">{folder}</span>
        ) : (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: entry.threadId }}
            className="wrap-anywhere hover:underline"
          >
            {entry.threadTitle ?? folder}
          </Link>
        )
      }
      description={entry.threadId === null ? "No thread uses this folder" : project}
      control={
        <span className="text-xs text-muted-foreground tabular-nums">
          {entry.bytes === null ? "Not measured" : formatBytes(entry.bytes)}
        </span>
      }
    />
  );
}
