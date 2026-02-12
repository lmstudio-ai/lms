import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import os from "os";

export interface DeviceNameResolver {
  localDeviceIdentifier: string | null;
  preferredDeviceIdentifier: string | null;
  localDeviceName: string | null;
  isLocal: (deviceIdentifier: string | null) => boolean;
  label: (deviceIdentifier: string | null) => string;
  normalizeIdentifier(deviceIdentifier: string | null): string | null;
  getPreferredDeviceName: () => string;
}

/**
 * Extracts the device identifier from a device-aware identifier. If not remote, returns null.
 */
export function extractDeviceIdentifierFromDeviceAwareIdentifier(deviceAwareIdentifier: string) {
  const split = deviceAwareIdentifier.split(":");
  if (split.length < 2) {
    return null;
  }
  return split[0];
}

class DeviceNameResolverImpl implements DeviceNameResolver {
  constructor(
    public readonly localDeviceIdentifier: string | null,
    public readonly localDeviceName: string | null,
    public readonly preferredDeviceIdentifier: string | null,
    private readonly remoteDeviceNameByIdentifier: Map<string, string>,
  ) {}

  isLocal(deviceIdentifier: string | null): boolean {
    return deviceIdentifier === null || deviceIdentifier === this.localDeviceIdentifier;
  }

  label(deviceIdentifier: string | null): string {
    if (deviceIdentifier === null || deviceIdentifier === this.localDeviceIdentifier) {
      return this.localDeviceName ?? "local";
    }
    const remoteDeviceName = this.remoteDeviceNameByIdentifier.get(deviceIdentifier);
    if (remoteDeviceName !== undefined) {
      return remoteDeviceName;
    }
    return this.formatUnknownDeviceIdentifier(deviceIdentifier);
  }

  normalizeIdentifier(deviceIdentifier: string | null): string | null {
    return this.isLocal(deviceIdentifier) ? null : deviceIdentifier;
  }

  getPreferredDeviceName(): string {
    return this.label(this.preferredDeviceIdentifier);
  }

  private formatUnknownDeviceIdentifier(deviceIdentifier: string): string {
    const prefixLength = 6;
    const prefix = deviceIdentifier.slice(0, prefixLength);
    return `remote:${prefix}`;
  }
}

export async function createDeviceNameResolver(
  client: LMStudioClient,
  logger: SimpleLogger,
): Promise<DeviceNameResolver> {
  try {
    const status = await client.repository.lmLink.status();
    const remoteDeviceNameByIdentifier = new Map<string, string>();
    for (const peer of status.peers) {
      remoteDeviceNameByIdentifier.set(peer.deviceIdentifier, peer.deviceName);
    }
    const localDeviceIdentifier = status.deviceIdentifier;
    const localDeviceName = status.deviceName;
    const preferredDeviceIdentifier = status.preferredDeviceIdentifier;
    return new DeviceNameResolverImpl(
      localDeviceIdentifier,
      localDeviceName,
      preferredDeviceIdentifier ?? null,
      remoteDeviceNameByIdentifier,
    );
  } catch (error) {
    logger.debug("Failed to fetch LM Link status:", error);
    return new DeviceNameResolverImpl(null, os.hostname(), null, new Map<string, string>());
  }
}
