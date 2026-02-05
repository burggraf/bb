// Type declarations for wa-sqlite examples
declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  export class OriginPrivateFileSystemVFS {
    name: string;
    mxPathName: number;

    mkdir(path: string): Promise<void>;
    xClose(fileId: number): number | Promise<number>;
    xRead(fileId: number, pData: { size: number; value: Uint8Array }, iOffset: number): number | Promise<number>;
    xWrite(fileId: number, pData: { size: number; value: Uint8Array }, iOffset: number): number | Promise<number>;
    xTruncate(fileId: number, iSize: number): number | Promise<number>;
    xSync(fileId: number, flags: any): number | Promise<number>;
    xFileSize(fileId: number, pSize64: DataView): number | Promise<number>;
    xLock(fileId: number, flags: number): number | Promise<number>;
    xUnlock(fileId: number, flags: number): number | Promise<number>;
    xCheckReservedLock(fileId: number, pResOut: DataView): number | Promise<number>;
    xFileControl(fileId: number, flags: number, pArg: DataView): number | Promise<number>;
    xDeviceCharacteristics(fileId: number): number;
    xOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): number | Promise<number>;
    xDelete(name: string, syncDir: number): number | Promise<number>;
    xAccess(name: string, flags: number, pResOut: DataView): number | Promise<number>;
  }
}
