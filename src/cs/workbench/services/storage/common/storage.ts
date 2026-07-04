import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { StorageService } from 'cs/platform/storage/common/storage';

export const IWorkbenchStorageService =
  createDecorator<IWorkbenchStorageService>('workbenchStorageService');

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
