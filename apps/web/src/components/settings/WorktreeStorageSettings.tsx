import type { EnvironmentId, WorktreeStorage } from "@t3tools/contracts";
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow } from "./settingsLayout";
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

/** Space taken by worktrees on each selected machine, shown atop the Cleanup rules. */
export function WorktreeStorageRows() {
  const { connectedEnvironments } = useSettingsScope();
  const machines = connectedEnvironments
    .filter(
      (environment) => environment.serverConfig?.environment.capabilities.worktreeStorage === true,
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
    }));
  return machines.map((machine) => (
    <MachineStorageRow
      key={machine.environmentId}
      machine={machine}
      showLabel={machines.length > 1}
    />
  ));
}

function MachineStorageRow({
  machine,
  showLabel,
}: {
  readonly machine: StorageMachine;
  readonly showLabel: boolean;
}) {
  const query = useEnvironmentQuery(worktreeStorageQuery(machine.environmentId));
  const storage = query.data;
  const title = showLabel
    ? `Space used by worktrees on ${machine.label}`
    : "Space used by worktrees";
  const totalBytes = storage?.worktrees.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) ?? 0;
  const count = storage?.worktrees.length ?? 0;
  const unmeasured = storage?.worktrees.filter((entry) => entry.bytes === null).length ?? 0;
  const volume = storage?.volume ?? null;
  return (
    <SettingsRow
      title={
        <span className="flex items-baseline gap-2">
          {title}
          {storage === null ? null : (
            <span className="text-muted-foreground tabular-nums">{formatBytes(totalBytes)}</span>
          )}
        </span>
      }
      description={
        storage === null
          ? (query.error ?? "Measuring…")
          : [
              `${count} ${count === 1 ? "worktree" : "worktrees"}`,
              volume === null
                ? null
                : `${formatPercent(totalBytes / volume.totalBytes)} of the ${formatBytes(volume.totalBytes)} disk, ${formatBytes(volume.freeBytes)} free`,
              unmeasured > 0 ? `${unmeasured} not measured` : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
      control={
        <div className="flex items-center gap-1.5">
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
          {storage === null ? null : (
            <CleanupButton machine={machine} storage={storage} onCleaned={query.refresh} />
          )}
        </div>
      }
    >
      {volume === null ? null : <DiskBar worktreeBytes={totalBytes} volume={volume} />}
    </SettingsRow>
  );
}

function DiskBar({
  worktreeBytes,
  volume,
}: {
  readonly worktreeBytes: number;
  readonly volume: NonNullable<WorktreeStorage["volume"]>;
}) {
  const used = volume.totalBytes - volume.freeBytes;
  const share = (bytes: number) => `${(Math.max(0, bytes) / volume.totalBytes) * 100}%`;
  return (
    <div
      className="mt-2.5 mb-2 flex h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: FREE_COLOR }}
    >
      <div
        className="min-w-0.5"
        style={{ width: share(worktreeBytes), background: WORKTREE_COLOR }}
      />
      <div style={{ width: share(used - worktreeBytes), background: OTHER_COLOR }} />
    </div>
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
