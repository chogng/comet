import {
  IStorageService,
  type StorageService,
} from 'cs/platform/storage/common/storage';
import { refineServiceDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IWorkbenchStorageService =
  refineServiceDecorator<StorageService, IWorkbenchStorageService>(
    IStorageService,
  );

export interface IWorkbenchStorageService extends StorageService {
  readonly _serviceBrand: undefined;
}

export {
  IS_NEW_KEY,
  StorageScope,
  StorageTarget,
  TARGET_KEY,
  WillSaveStateReason,
} from 'cs/platform/storage/common/storage';
export type {
  IStorageValueChangeEvent,
  IWillSaveStateEvent,
  StorageService,
  TranslationCacheRecord,
} from 'cs/platform/storage/common/storage';
