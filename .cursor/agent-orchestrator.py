#!/usr/bin/env python3
"""
Multi-Agent Worktree Orchestrator
Manages multiple AI agents working in parallel worktrees with intelligent merging.
"""

import os
import json
import subprocess
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Set
from datetime import datetime
from dataclasses import dataclass, asdict
import difflib

@dataclass
class AgentConfig:
    """Configuration for a single agent"""
    name: str
    worktree_path: str
    branch: str
    task: str
    priority: int = 1  # Higher = more important
    enabled: bool = True

@dataclass
class ChangeRecord:
    """Record of changes made by an agent"""
    agent_name: str
    file_path: str
    change_type: str  # 'added', 'modified', 'deleted'
    lines_added: int
    lines_removed: int
    timestamp: str
    commit_hash: Optional[str] = None

class WorktreeOrchestrator:
    def __init__(self, repo_root: str, config_file: str = ".cursor/agent-config.json"):
        self.repo_root = Path(repo_root).resolve()
        self.config_file = self.repo_root / config_file
        self.agents: Dict[str, AgentConfig] = {}
        self.changes: List[ChangeRecord] = []
        self.load_config()
        
    def load_config(self):
        """Load agent configuration from JSON file"""
        if self.config_file.exists():
            with open(self.config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.agents = {
                    name: AgentConfig(**config)
                    for name, config in data.get('agents', {}).items()
                }
        else:
            self.create_default_config()
    
    def create_default_config(self):
        """Create default configuration with 3 worker agents + 1 consolidation agent"""
        self.agents = {
            'agent-1': AgentConfig(
                name='agent-1',
                worktree_path='.worktrees/agent-1',
                branch='agent-1-work',
                task='Primary implementation',
                priority=2
            ),
            'agent-2': AgentConfig(
                name='agent-2',
                worktree_path='.worktrees/agent-2',
                branch='agent-2-work',
                task='Alternative approach',
                priority=2
            ),
            'agent-3': AgentConfig(
                name='agent-3',
                worktree_path='.worktrees/agent-3',
                branch='agent-3-work',
                task='Optimization focus',
                priority=2
            ),
            'consolidator': AgentConfig(
                name='consolidator',
                worktree_path='.worktrees/consolidator',
                branch='consolidated',
                task='Merge and optimize best solutions from agents 1-3',
                priority=3
            )
        }
        self.save_config()
    
    def save_config(self):
        """Save agent configuration to JSON file"""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            'agents': {
                name: asdict(agent)
                for name, agent in self.agents.items()
            },
            'last_updated': datetime.now().isoformat()
        }
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def run_git(self, *args, cwd: Optional[Path] = None) -> subprocess.CompletedProcess:
        """Run git command"""
        cwd = cwd or self.repo_root
        result = subprocess.run(
            ['git'] + list(args),
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False
        )
        return result
    
    def create_worktree(self, agent: AgentConfig) -> bool:
        """Create a new worktree for an agent"""
        worktree_path = self.repo_root / agent.worktree_path
        
        # Check if worktree already exists
        if worktree_path.exists():
            print(f"Worktree {agent.worktree_path} already exists")
            return True
        
        # Create branch if it doesn't exist
        branch_check = self.run_git('show-ref', '--verify', '--quiet', f'refs/heads/{agent.branch}')
        if branch_check.returncode != 0:
            # Create branch from current HEAD
            self.run_git('checkout', '-b', agent.branch)
            self.run_git('checkout', '-')  # Return to original branch
        
        # Create worktree
        result = self.run_git('worktree', 'add', str(worktree_path), agent.branch)
        if result.returncode == 0:
            print(f"✓ Created worktree for {agent.name} at {agent.worktree_path}")
            return True
        else:
            print(f"✗ Failed to create worktree for {agent.name}: {result.stderr}")
            return False
    
    def remove_worktree(self, agent: AgentConfig, force: bool = False) -> bool:
        """Remove a worktree"""
        worktree_path = self.repo_root / agent.worktree_path
        
        if not worktree_path.exists():
            return True
        
        if force:
            shutil.rmtree(worktree_path)
            self.run_git('worktree', 'prune')
            self.run_git('branch', '-D', agent.branch)
        else:
            result = self.run_git('worktree', 'remove', str(worktree_path))
            if result.returncode != 0:
                print(f"Warning: Could not remove worktree cleanly: {result.stderr}")
                return False
        
        print(f"✓ Removed worktree for {agent.name}")
        return True
    
    def setup_all_worktrees(self):
        """Create worktrees for all enabled agents"""
        print("Setting up worktrees for all agents...")
        for agent in self.agents.values():
            if agent.enabled:
                self.create_worktree(agent)
    
    def get_changed_files(self, agent: AgentConfig, base_branch: str = 'main') -> List[str]:
        """Get list of files changed by an agent"""
        worktree_path = self.repo_root / agent.worktree_path
        result = self.run_git(
            'diff', '--name-only', f'{base_branch}..{agent.branch}',
            cwd=worktree_path
        )
        if result.returncode == 0:
            return [f.strip() for f in result.stdout.split('\n') if f.strip()]
        return []
    
    def analyze_changes(self, agent: AgentConfig, base_branch: str = 'main') -> List[ChangeRecord]:
        """Analyze changes made by an agent"""
        worktree_path = self.repo_root / agent.worktree_path
        result = self.run_git(
            'diff', '--stat', f'{base_branch}..{agent.branch}',
            cwd=worktree_path
        )
        
        changes = []
        if result.returncode == 0:
            for line in result.stdout.split('\n'):
                if '|' in line and 'file changed' not in line:
                    parts = line.split('|')
                    if len(parts) >= 2:
                        file_path = parts[0].strip()
                        stats = parts[1].strip()
                        
                        # Parse stats: "5 +- 3 --" or "10 +++++"
                        added = 0
                        removed = 0
                        if '+' in stats:
                            added = len([c for c in stats if c == '+'])
                        if '-' in stats:
                            removed = len([c for c in stats if c == '-'])
                        
                        change_type = 'modified'
                        if added > 0 and removed == 0:
                            change_type = 'added'
                        elif added == 0 and removed > 0:
                            change_type = 'deleted'
                        
                        changes.append(ChangeRecord(
                            agent_name=agent.name,
                            file_path=file_path,
                            change_type=change_type,
                            lines_added=added,
                            lines_removed=removed,
                            timestamp=datetime.now().isoformat()
                        ))
        
        return changes
    
    def detect_conflicts(self, agents: List[AgentConfig], base_branch: str = 'main') -> Dict[str, List[str]]:
        """Detect files modified by multiple agents (potential conflicts)"""
        file_to_agents: Dict[str, List[str]] = {}
        
        for agent in agents:
            if not agent.enabled:
                continue
            changed_files = self.get_changed_files(agent, base_branch)
            for file_path in changed_files:
                if file_path not in file_to_agents:
                    file_to_agents[file_path] = []
                file_to_agents[file_path].append(agent.name)
        
        # Return only files modified by multiple agents
        conflicts = {
            file: agents
            for file, agents in file_to_agents.items()
            if len(agents) > 1
        }
        
        return conflicts
    
    def create_consolidation_branch(self, worker_agents: List[str], base_branch: str = 'main'):
        """Create consolidation branch with best changes from worker agents"""
        consolidator = self.agents.get('consolidator')
        if not consolidator or not consolidator.enabled:
            print("Consolidator agent not configured")
            return False
        
        consolidator_path = self.repo_root / consolidator.worktree_path
        
        # Ensure consolidator worktree exists
        if not consolidator_path.exists():
            self.create_worktree(consolidator)
        
        # Start from base branch
        self.run_git('checkout', base_branch, cwd=consolidator_path)
        self.run_git('checkout', '-b', consolidator.branch, cwd=consolidator_path)
        
        # Analyze all changes
        all_changes: Dict[str, Dict[str, ChangeRecord]] = {}
        for agent_name in worker_agents:
            agent = self.agents.get(agent_name)
            if not agent or not agent.enabled:
                continue
            
            changes = self.analyze_changes(agent, base_branch)
            for change in changes:
                if change.file_path not in all_changes:
                    all_changes[change.file_path] = {}
                all_changes[change.file_path][agent_name] = change
        
        # Detect conflicts
        worker_agent_configs = [self.agents[name] for name in worker_agents if name in self.agents]
        conflicts = self.detect_conflicts(worker_agent_configs, base_branch)
        
        # Strategy: For each file, pick the best version
        # Priority: agent with most changes (most comprehensive), or highest priority
        for file_path, agent_changes in all_changes.items():
            if file_path in conflicts:
                # Multiple agents modified this file - need intelligent merge
                print(f"⚠ Conflict detected in {file_path} by {conflicts[file_path]}")
                # Pick agent with highest priority or most comprehensive changes
                best_agent = max(
                    agent_changes.keys(),
                    key=lambda a: (
                        self.agents[a].priority,
                        agent_changes[a].lines_added + agent_changes[a].lines_removed
                    )
                )
                print(f"  → Using version from {best_agent}")
                source_agent = self.agents[best_agent]
                self.copy_file_from_agent(file_path, source_agent, consolidator_path)
            else:
                # Single agent modified - safe to copy
                agent_name = list(agent_changes.keys())[0]
                source_agent = self.agents[agent_name]
                self.copy_file_from_agent(file_path, source_agent, consolidator_path)
        
        # Commit consolidation
        self.run_git('add', '-A', cwd=consolidator_path)
        result = self.run_git('commit', '-m', 
            f'Consolidated changes from {", ".join(worker_agents)}',
            cwd=consolidator_path
        )
        
        if result.returncode == 0:
            print(f"✓ Created consolidation branch with changes from {len(worker_agents)} agents")
            return True
        else:
            print(f"✗ Failed to create consolidation: {result.stderr}")
            return False
    
    def copy_file_from_agent(self, file_path: str, source_agent: AgentConfig, dest_path: Path):
        """Copy a file from agent's worktree to destination"""
        source_path = self.repo_root / source_agent.worktree_path / file_path
        dest_file = dest_path / file_path
        
        if source_path.exists():
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, dest_file)
    
    def generate_report(self) -> str:
        """Generate a report of all agent activities"""
        report = []
        report.append("=" * 80)
        report.append("MULTI-AGENT WORKTREE REPORT")
        report.append("=" * 80)
        report.append(f"Generated: {datetime.now().isoformat()}\n")
        
        # List all agents
        report.append("AGENTS:")
        for name, agent in self.agents.items():
            status = "✓ Enabled" if agent.enabled else "✗ Disabled"
            worktree_exists = (self.repo_root / agent.worktree_path).exists()
            worktree_status = "✓ Exists" if worktree_exists else "✗ Missing"
            report.append(f"  {name}: {status} | Worktree: {worktree_status}")
            report.append(f"    Branch: {agent.branch}")
            report.append(f"    Task: {agent.task}")
            report.append(f"    Priority: {agent.priority}\n")
        
        # Analyze changes
        worker_agents = [name for name in self.agents.keys() if name != 'consolidator']
        if worker_agents:
            report.append("CHANGES ANALYSIS:")
            conflicts = self.detect_conflicts(
                [self.agents[name] for name in worker_agents if name in self.agents],
                'main'
            )
            
            for agent_name in worker_agents:
                agent = self.agents.get(agent_name)
                if not agent or not agent.enabled:
                    continue
                
                changes = self.analyze_changes(agent, 'main')
                changed_files = self.get_changed_files(agent, 'main')
                
                report.append(f"\n  {agent_name}:")
                report.append(f"    Files changed: {len(changed_files)}")
                report.append(f"    Total changes: {sum(c.lines_added + c.lines_removed for c in changes)} lines")
                
                if changed_files:
                    report.append(f"    Files:")
                    for file_path in changed_files[:10]:  # Limit to 10 files
                        conflict_marker = " ⚠ CONFLICT" if file_path in conflicts else ""
                        report.append(f"      - {file_path}{conflict_marker}")
                    if len(changed_files) > 10:
                        report.append(f"      ... and {len(changed_files) - 10} more")
            
            if conflicts:
                report.append("\n⚠ CONFLICTS DETECTED:")
                for file_path, agents in conflicts.items():
                    report.append(f"  {file_path}: modified by {', '.join(agents)}")
        
        report.append("\n" + "=" * 80)
        return "\n".join(report)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Multi-Agent Worktree Orchestrator')
    parser.add_argument('command', choices=['setup', 'remove', 'consolidate', 'report', 'config'],
                        help='Command to execute')
    parser.add_argument('--agent', help='Specific agent name (for remove command)')
    parser.add_argument('--workers', nargs='+', default=['agent-1', 'agent-2', 'agent-3'],
                        help='Worker agent names for consolidation')
    parser.add_argument('--base', default='main', help='Base branch name')
    parser.add_argument('--force', action='store_true', help='Force removal')
    
    args = parser.parse_args()
    
    # Find repo root (look for .git directory)
    repo_root = Path.cwd()
    while repo_root != repo_root.parent:
        if (repo_root / '.git').exists():
            break
        repo_root = repo_root.parent
    else:
        print("Error: Not in a git repository")
        return 1
    
    orchestrator = WorktreeOrchestrator(str(repo_root))
    
    if args.command == 'setup':
        orchestrator.setup_all_worktrees()
        print("\n✓ All worktrees set up. You can now:")
        print("  1. Open each worktree in separate Cursor windows")
        print("  2. Assign different agents to each worktree")
        print("  3. Run 'python .cursor/agent-orchestrator.py consolidate' when done")
    
    elif args.command == 'remove':
        if args.agent:
            agent = orchestrator.agents.get(args.agent)
            if agent:
                orchestrator.remove_worktree(agent, force=args.force)
            else:
                print(f"Agent {args.agent} not found")
        else:
            print("Please specify --agent")
    
    elif args.command == 'consolidate':
        orchestrator.create_consolidation_branch(args.workers, args.base)
        print("\n✓ Consolidation complete. Review the consolidated branch and merge when ready.")
    
    elif args.command == 'report':
        print(orchestrator.generate_report())
    
    elif args.command == 'config':
        print(f"Configuration file: {orchestrator.config_file}")
        print("\nCurrent agents:")
        for name, agent in orchestrator.agents.items():
            print(f"  {name}: {agent.task}")
    
    return 0

if __name__ == '__main__':
    exit(main())

