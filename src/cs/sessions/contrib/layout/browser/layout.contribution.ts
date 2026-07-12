/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/sessions/contrib/layout/browser/layoutActions';
import 'cs/sessions/contrib/layout/browser/layoutContextKeys';
import { StandardSessionsLayoutPolicy } from 'cs/sessions/contrib/layout/browser/standardSessionsLayoutPolicy';
import { registerSessionsLayoutPolicy } from 'cs/sessions/services/layout/browser/layoutPolicy';

registerSessionsLayoutPolicy(StandardSessionsLayoutPolicy);
