/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IApplicationQuitEvent {
	preventDefault(): void;
}

export interface IApplicationQuitWindow {
	isDestroyed(): boolean;
	once(event: 'closed', listener: () => void): void;
	removeListener(event: 'closed', listener: () => void): void;
	close(): void;
}

export class ApplicationQuitCoordinator {
	private quitRequested = false;
	private quitAllowed = false;
	private quitPreparation: Promise<void> | undefined;

	constructor(
		private readonly getWindows: () => readonly IApplicationQuitWindow[],
		private readonly prepareApplicationQuit: () => Promise<void>,
		private readonly quitApplication: () => void,
		private readonly reportPreparationError: (error: unknown) => void,
	) {}

	handleBeforeQuit(event: IApplicationQuitEvent): void {
		this.quitRequested = true;
		if (this.quitAllowed) {
			return;
		}
		event.preventDefault();
		if (!this.quitPreparation) {
			this.quitPreparation = this.closeWindowsAndPrepareApplicationQuit();
			void this.quitPreparation.then(
				() => this.resumeApplicationQuit(),
				error => {
					try {
						this.reportPreparationError(error);
					} finally {
						this.resumeApplicationQuit();
					}
				},
			);
		}
	}

	handleActivate(createMainWindow: () => void): void {
		if (!this.quitRequested && this.getWindows().length === 0) {
			createMainWindow();
		}
	}

	handleWindowAllClosed(keepApplicationAlive: boolean): void {
		if (this.quitRequested || !keepApplicationAlive) {
			this.quitApplication();
		}
	}

	private async closeWindowsAndPrepareApplicationQuit(): Promise<void> {
		const errors: unknown[] = [];
		const closeResults = await Promise.allSettled(this.getWindows().map(window => this.closeWindow(window)));
		for (const result of closeResults) {
			if (result.status === 'rejected') {
				errors.push(result.reason);
			}
		}
		try {
			await this.prepareApplicationQuit();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Failed to prepare application quit.');
		}
	}

	private closeWindow(window: IApplicationQuitWindow): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (window.isDestroyed()) {
				resolve();
				return;
			}
			window.once('closed', resolve);
			try {
				window.close();
			} catch (error) {
				window.removeListener('closed', resolve);
				reject(error);
			}
		});
	}

	private resumeApplicationQuit(): void {
		this.quitAllowed = true;
		this.quitApplication();
	}
}
