import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";

export interface DeviceNameResolver {
  localDeviceIdentifier: string | null;
  preferredDeviceIdentifier: string | null;
  localDeviceName: string | null;
  isLocal: (deviceIdentifier: string | null) => boolean;
  label: (deviceIdentifier: string | null) => string;
  getPreferredDeviceName: () => string;
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
    return new DeviceNameResolverImpl(null, null, null, new Map<string, string>());
  }
}
