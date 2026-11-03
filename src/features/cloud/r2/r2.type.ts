import type { NetworkOptions, NativeResponse } from '../../storage/native.type'
export type CloudTransport = (options: NetworkOptions) => Promise<NativeResponse>
