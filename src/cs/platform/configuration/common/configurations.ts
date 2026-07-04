import { ConfigurationModel } from 'cs/platform/configuration/common/configurationModels';
import { configurationRegistry } from 'cs/platform/configuration/common/configurationRegistry';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { EventEmitter } from 'cs/base/common/event';

export class DefaultConfiguration implements DisposableLike {
  private readonly store = new DisposableStore();
  private readonly didChangeConfigurationEmitter = new EventEmitter<{
    defaults: ConfigurationModel;
    properties: string[];
  }>();
  private configurationModelValue = ConfigurationModel.createEmptyModel();

  readonly onDidChangeConfiguration = this.didChangeConfigurationEmitter.event;

  get configurationModel() {
    return this.configurationModelValue;
  }

  initialize(): ConfigurationModel {
    this.reload();
    this.store.add(
      configurationRegistry.onDidUpdateConfiguration(({ properties }) => {
        this.reload();
        this.didChangeConfigurationEmitter.fire({
          defaults: this.configurationModel,
          properties: [...properties],
        });
      }),
    );
    return this.configurationModel;
  }

  reload(): ConfigurationModel {
    const model = ConfigurationModel.createEmptyModel();
    for (const [key, schema] of Object.entries(configurationRegistry.getConfigurationProperties())) {
      model.setValue(key, schema.default);
    }
    this.configurationModelValue = model;
    return model;
  }

  dispose(): void {
    this.store.dispose();
    this.didChangeConfigurationEmitter.dispose();
  }
}
