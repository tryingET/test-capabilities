Feature: documented CLI workflows stay executable
  Selected operator-facing CLI examples and error flows remain wired to the shipped runtime.

  Scenario: quick CLI smoke example passes
    Given the docs file "docs/api/examples.md" contains "test-capabilities test --quick --config test-capabilities.yaml"
    And the docs file "docs/api/cli.md" contains "test-capabilities test [options]"
    And a temporary config file named "test-capabilities.yaml" targets the CLI command "node"
    When I run the TEST-CAPABILITIES CLI with:
      | test |
      | --quick |
      | --config |
      | test-capabilities.yaml |
    Then the command exits with code 0
    And the combined output contains "Testing complete (pass)."
    And the combined output contains "Coverage gaps: userFlows, apiEndpoints"

  Scenario: surf explore example passes through the shipped wrapper path
    Given the docs file "docs/api/examples.md" contains "test-capabilities surf explore --url https://example.com"
    And the docs file "docs/api/cli.md" contains "test-capabilities surf explore --url https://example.com"
    And a fake surf executable is on PATH that prints:
      """
      printf "surf:%s\n" "$1"
      printf "%s\n" "$2"
      """
    When I run the TEST-CAPABILITIES CLI with:
      | surf |
      | explore |
      | --url |
      | https://example.com |
    Then the command exits with code 0
    And the combined output contains "Surf explore complete."
    And the combined output contains "surf:go"
    And the combined output contains "https://example.com"

  Scenario: quantum requires an explicit target
    Given the docs file "docs/api/cli.md" contains "test-capabilities quantum --target https://example.com --branches 100 --collapse"
    And the docs file "docs/api/errors.md" contains "Quantum simulation requires --target with a valid URL."
    When I run the TEST-CAPABILITIES CLI with:
      | quantum |
    Then the command exits with code 1
    And the combined output contains "Quantum simulation requires --target with a valid URL."

  Scenario: healing fails closed when the target directory is missing
    Given the docs file "docs/api/cli.md" contains "test-capabilities heal --dir ./tests --dry-run"
    And the docs file "docs/api/errors.md" contains "Heal directory not found: /path/to/tests. Use --dir with an existing directory."
    When I run the TEST-CAPABILITIES CLI with:
      | heal |
      | --dir |
      | missing-tests |
    Then the command exits with code 1
    And the combined output contains "Heal directory not found:"
