import {
  createApplicationStorageMain,
  type IStorageMain,
  type IStorageMainOptions,
} from 'cs/platform/storage/electron-main/storageMain';
import { ApplicationStorageService } from 'cs/platform/storage/common/storageService';

export interface IStorageMainService {
  readonly applicationStorage: IStorageMain;
  init(): Promise<void>;
  close(): Promise<void>;
}

export interface IStorageMainServicePaths {
  readonly stateDbFile: string;
}

export interface IStorageMainServiceOptions extends IStorageMainOptions {}

export class StorageMainService extends ApplicationStorageService implements IStorageMainService {
  readonly applicationStorageMain: IStorageMain;
  constructor(
    paths: IStorageMainServicePaths,
    options: IStorageMainServiceOptions = {},
  ) {
    const applicationStorage = createApplicationStorageMain(
      paths.stateDbFile,
      options,
    );
    super(applicationStorage.storage);
    this.applicationStorageMain = applicationStorage;
  }

  get applicationStorage(): IStorageMain {
    return this.applicationStorageMain;
  }

  override async init(): Promise<void> {
    await this.applicationStorageMain.init();
  }

  override async close(): Promise<void> {
    await this.applicationStorageMain.close();
  }
}

export function createStorageMainService(
  paths: IStorageMainServicePaths,
  options?: IStorageMainServiceOptions,
): StorageMainService {
  return new StorageMainService(paths, options);
}
