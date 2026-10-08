# Copyright 2026 The Kubeflow Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
# Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
"""Checks specific to the validation-only image-reuse wrapper."""

from pathlib import Path
import unittest


class DiagnosticWorkflowTests(unittest.TestCase):

    def test_source_only_wrapper_cannot_load_or_run_candidate(self):
        root = Path(__file__).resolve().parents[2]
        text = (root / '.github/workflows/upgrade-test.yml').read_text()
        self.assertIn('readiness-adoption.sh source', text)
        self.assertIn('readiness-schedules.sh source', text)
        self.assertNotIn('readiness-adoption.sh target', text)
        self.assertNotIn('uses: ./.github/actions/deploy', text)
        self.assertNotIn('SOURCE_RUN', text)


if __name__ == '__main__':
    unittest.main()
