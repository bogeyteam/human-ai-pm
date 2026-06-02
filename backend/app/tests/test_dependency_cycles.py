"""Unit tests for acyclic_dependency_edges (A2 — DAG cycle protection).

The task generator persists LLM-proposed task dependencies. The model can
propose cycles (A→B→A); these must never reach the DB, or downstream DAG
traversal in the optimizer / kanban ordering would loop.
"""

from app.api.generate import acyclic_dependency_edges


def test_keeps_a_simple_chain():
    kept, skipped = acyclic_dependency_edges([(0, 1), (1, 2)])
    assert kept == [(0, 1), (1, 2)]
    assert skipped == []


def test_drops_the_edge_that_closes_a_direct_cycle():
    # 0→1 then 1→0 would form A↔B; the second edge is dropped.
    kept, skipped = acyclic_dependency_edges([(0, 1), (1, 0)])
    assert kept == [(0, 1)]
    assert skipped == [(1, 0)]


def test_drops_the_edge_that_closes_a_transitive_cycle():
    # 0→1→2, then 2→0 would close a 3-node cycle.
    kept, skipped = acyclic_dependency_edges([(0, 1), (1, 2), (2, 0)])
    assert kept == [(0, 1), (1, 2)]
    assert skipped == [(2, 0)]


def test_drops_self_loops():
    kept, skipped = acyclic_dependency_edges([(3, 3)])
    assert kept == []
    assert skipped == [(3, 3)]


def test_unrelated_edges_all_kept():
    edges = [(0, 1), (2, 3), (4, 5)]
    kept, skipped = acyclic_dependency_edges(edges)
    assert kept == edges
    assert skipped == []


def test_diamond_is_acyclic_and_fully_kept():
    # 0→1, 0→2, 1→3, 2→3 — a diamond, no cycle.
    edges = [(0, 1), (0, 2), (1, 3), (2, 3)]
    kept, skipped = acyclic_dependency_edges(edges)
    assert kept == edges
    assert skipped == []


def test_empty_input():
    assert acyclic_dependency_edges([]) == ([], [])
