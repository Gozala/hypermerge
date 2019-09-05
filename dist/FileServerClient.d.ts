/// <reference types="node" />
import { Readable } from 'stream';
import { HyperfileUrl } from './Misc';
export default class FileServerClient {
    serverPath?: string;
    write(data: Readable, size: number, mimeType: string): Promise<HyperfileUrl>;
    read(url: HyperfileUrl): Promise<[Readable, string, number]>;
}
