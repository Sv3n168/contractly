"""Contractly – self-hosted contract manager.

SPDX-License-Identifier: AGPL-3.0-only
"""

import os

__version__ = "1.1.0"
# set at image build time (git tag or commit); "dev" when running from source
BUILD = os.environ.get("CONTRACTLY_BUILD", "dev")
