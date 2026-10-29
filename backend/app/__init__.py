"""Contractly – self-hosted contract manager."""

import os

__version__ = "1.1.0"
# set at image build time (git tag or commit); "dev" when running from source
BUILD = os.environ.get("CONTRACTLY_BUILD", "dev")
