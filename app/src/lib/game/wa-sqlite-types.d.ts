// Type declarations for wa-sqlite examples
declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  import { SQLiteVFS } from 'wa-sqlite';

  export class OriginPrivateFileSystemVFS implements SQLiteVFS {
    name: string;
    mxPathName: number;

    mkdir(path: string): Promise<void>;
    xClose(fileId: number): number | Promise<number>;
    xRead(fileId: number, pData: { size: number; value: Uint8Array }, iOffset: number): number;
    xWrite(fileId: number, pData: { size: number; value: Uint8Array }, iOffset: number): number;
    xTruncate(fileId: number, iSize: number): number;
    xSync(fileId: number, flags: any): number;
    xFileSize(fileId: number, pSize64: DataView): number | Promise<number>;
    xLock(fileId: number, flags: number): number;
    xUnlock(fileId: number, flags: number): number;
    xCheckReservedLock(fileId: number, pResOut: DataView): number;
    xFileControl(fileId: number, flags: number, pArg: DataView): number;
    xDeviceCharacteristics(fileId: number): number;
    xOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): number | Promise<number>;
    xDelete(name: string, syncDir: number): number | Promise<number>;
    xAccess(name: string, flags: number, pResOut: DataView): number | Promise<number>;
  }
}
