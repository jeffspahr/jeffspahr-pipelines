# Copyright 2026 The Kubeflow Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
# Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
"""Checks specific to the validation-only image-reuse wrapper."""

from pathlib import Path
import unittest


class DiagnosticWorkflowTests(unittest.TestCase):

    def test_provenance_script_does_not_interpolate_github_expressions(self):
        root = Path(__file__).resolve().parents[2]
        text = (root / '.github/workflows/upgrade-test.yml').read_text()
        step = text.split(
            '      - name: Verify reused image provenance and runtime equivalence',
            1)[1].split('\n      - name:', 1)[0]
        script = step.split('        run: |\n', 1)[1]
        self.assertNotIn('${{', script)


if __name__ == '__main__':
    unittest.main()
