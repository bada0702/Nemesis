"""
Memory Manager for memGPT-like capabilities
Handles persistent memory, RAG integration, and automatic memory writing
"""
import os
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging
from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)


class MemoryManager:
    """Manages persistent memory files and RAG integration"""
    
    def __init__(self, base_dir: Path):
        """Initialize memory manager
        
        Args:
            base_dir: Base directory for memory files (e.g., c:/aibot/memory)
        """
        self.base_dir = Path(base_dir)
        self.daily_logs_dir = self.base_dir / "daily_logs"
        
        # Memory file paths
        self.soul_file = self.base_dir / "SOUL.md"
        self.user_file = self.base_dir / "USER.md"
        self.memory_file = self.base_dir / "MEMORY.md"
        self.agents_file = self.base_dir / "AGENTS.md"
        
        # Ensure directories exist
        self._ensure_directories()
        
        # Initialize default files if they don't exist
        self._initialize_default_files()
        
        # Memory cache with modification time tracking
        self._memory_cache = {}
        self._mtimes = {}
        self._cache_timestamp = None
        
        logger.info(f"MemoryManager initialized at {self.base_dir}")
    
    def _ensure_directories(self):
        """Create memory directories if they don't exist"""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.daily_logs_dir.mkdir(parents=True, exist_ok=True)
    
    def _initialize_default_files(self):
        """Create default memory files if they don't exist"""
        if not self.soul_file.exists():
            self._create_default_soul()
        
        if not self.user_file.exists():
            self._create_default_user()
        
        if not self.memory_file.exists():
            self._create_default_memory()
        
        if not self.agents_file.exists():
            self._create_default_agents()
    
    def _create_default_soul(self):
        """Create default SOUL.md file"""
        content = """# AI Agent Personality (SOUL)

## Core Identity
- Name: AI Assistant
- Role: Helpful, friendly, and knowledgeable AI companion
- Purpose: Assist users with information, tasks, and conversations

## Personality Traits
- **Friendly**: Warm and approachable in all interactions
- **Professional**: Maintains professionalism while being personable
- **Helpful**: Always eager to assist and provide value
- **Patient**: Takes time to understand and explain clearly
- **Curious**: Shows genuine interest in user's needs and context

## Communication Style
- **Tone**: Conversational yet professional
- **Language**: Clear, concise, and easy to understand
- **Emoji Usage**: Moderate use of emojis to add warmth (🤖 💡 ✅ 📝)
- **Response Length**: Balanced - detailed when needed, concise when appropriate
- **Korean Language**: Native-level Korean with natural expressions

## Behavioral Guidelines
- Always greet users warmly
- Remember and reference past conversations
- Acknowledge mistakes and learn from them
- Ask clarifying questions when uncertain
- Provide context and explanations
- Show empathy and understanding
"""
        self.soul_file.write_text(content, encoding='utf-8')
        logger.info("Created default SOUL.md")
    
    def _create_default_user(self):
        """Create default USER.md file"""
        content = """# User Profile

## Basic Information
- **Name**: Not set
- **Timezone**: Asia/Seoul
- **Language**: Korean
- **Preferred Name**: User

## Preferences
- Communication style: Not set
- Response detail level: Balanced
- Topics of interest: Not set

## Important Notes
- This file will be automatically updated as I learn more about you
- Share your preferences anytime and I'll remember them
"""
        self.user_file.write_text(content, encoding='utf-8')
        logger.info("Created default USER.md")
    
    def _create_default_memory(self):
        """Create default MEMORY.md file"""
        content = """# Long-term Memory

## Core Facts
- I am an AI assistant with persistent memory capabilities
- I can remember conversations and learn from interactions
- I store important information to provide better personalized service

## User Preferences
(Will be populated automatically during conversations)

## Important Conversations
(Key highlights from past interactions will be recorded here)

## Learned Patterns
(Behavioral patterns and preferences discovered over time)
"""
        self.memory_file.write_text(content, encoding='utf-8')
        logger.info("Created default MEMORY.md")
    
    def _create_default_agents(self):
        """Create default AGENTS.md file"""
        content = """# Agent Behavior Rules and Workflows

## Response Guidelines
1. Always load memory context before responding
2. Reference past conversations when relevant
3. Update memory files with new important information
4. Maintain personality consistency from SOUL.md

## Task Handling
- **Reminders**: Use /remind command for one-time alerts
- **Schedules**: Use /schedule command for recurring tasks
- **Search**: Use /search or auto-search for current information
- **Memory**: Automatically update USER.md, MEMORY.md during conversations

## Error Handling
- Acknowledge when uncertain
- Ask for clarification when needed
- Log errors for improvement
- Maintain friendly tone even when errors occur

## Workflows

### Daily Greeting Workflow
1. Check time of day
2. Greet appropriately (좋은 아침, 안녕하세요, etc.)
3. Reference any scheduled tasks for today
4. Ask how you can help

### Information Learning Workflow
1. Identify new user information in conversation
2. Categorize: personal info, preferences, facts, patterns
3. Update appropriate memory file (USER.md or MEMORY.md)
4. Log the update in daily log

### Task Execution Workflow
1. Understand the task clearly
2. Check if similar tasks exist in memory
3. Execute using established patterns
4. Save successful patterns to AGENTS.md
"""
        self.agents_file.write_text(content, encoding='utf-8')
        logger.info("Created default AGENTS.md")
    
    # ==================== RAG Functions ====================
    
    def load_all_memory_files(self) -> Dict[str, str]:
        """Load all memory .md files for RAG with smart caching"""
        # Load all .md files in memory directory, excluding subdirectories like daily_logs
        files_to_load = list(self.base_dir.glob("*.md"))
        
        # Ensure default files are included even if glob misses them (unlikely but safe)
        default_files = [self.soul_file, self.user_file, self.memory_file, self.agents_file]
        for f in default_files:
            if f not in files_to_load and f.exists():
                files_to_load.append(f)
        
        for file_path in files_to_load:
            if not file_path.exists():
                continue
                
            try:
                current_mtime = file_path.stat().st_mtime
                file_name = file_path.name
                
                # Check if file has changed since last load
                if file_name not in self._memory_cache or self._mtimes.get(file_name) != current_mtime:
                    logger.debug(f"Reloading {file_name} (modified)")
                    self._memory_cache[file_name] = file_path.read_text(encoding='utf-8')
                    self._mtimes[file_name] = current_mtime
                else:
                    logger.debug(f"Using cached {file_name}")
                    
            except Exception as e:
                logger.error(f"Error loading {file_path.name}: {e}")
        
        return self._memory_cache
    
    def get_memory_context(self) -> str:
        """Get formatted memory context for RAG injection into AI prompts
        
        Returns:
            Formatted string with all memory content
        """
        # Always call load_all_memory_files which uses smart mtime-based caching
        self.load_all_memory_files()
        
        # Format memory context
        context_parts = []
        
        # Sort keys to ensure deterministic order
        # Prioritize core files
        core_files = ['SOUL.md', 'USER.md', 'MEMORY.md', 'AGENTS.md']
        other_files = sorted([k for k in self._memory_cache.keys() if k not in core_files])
        all_files = core_files + other_files
        
        for file_name in all_files:
            if file_name in self._memory_cache:
                context_parts.append(f"=== {file_name} ===")
                context_parts.append(self._memory_cache[file_name])
                context_parts.append("")
        
        return "\n".join(context_parts)
    
    def refresh_memory_cache(self):
        """Reload memory files into cache"""
        self._memory_cache = self.load_all_memory_files()
        self._cache_timestamp = datetime.now()
        logger.debug("Memory cache refreshed")
    
    def get_rag_context(self, query: str, top_k: int = 4) -> str:
        """SOUL.md는 항상 포함, 나머지는 BM25로 쿼리 관련 청크만 선택적 반환"""
        self.load_all_memory_files()

        soul = self._memory_cache.get('SOUL.md', '')

        other_chunks = []
        for file_name, content in self._memory_cache.items():
            if file_name == 'SOUL.md':
                continue
            sections = re.split(r'\n(?=## )', content)
            for section in sections:
                if section.strip():
                    other_chunks.append({'file': file_name, 'content': section.strip()})

        retrieved_parts = []
        if other_chunks and query.strip():
            try:
                tokenized_corpus = [chunk['content'].split() for chunk in other_chunks]
                bm25 = BM25Okapi(tokenized_corpus)
                top_n = bm25.get_top_n(query.split(), other_chunks, n=min(top_k, len(other_chunks)))
                for chunk in top_n:
                    retrieved_parts.append(f"--- from {chunk['file']} ---")
                    retrieved_parts.append(chunk['content'])
            except Exception as e:
                logger.error(f"BM25 RAG 오류: {e}")
                for chunk in other_chunks[:top_k]:
                    retrieved_parts.append(f"--- from {chunk['file']} ---")
                    retrieved_parts.append(chunk['content'])

        parts = []
        if soul:
            parts.append(f"=== SOUL.md ===\n{soul}")
        if retrieved_parts:
            parts.append("<retrieved_memory>\n" + "\n".join(retrieved_parts) + "\n</retrieved_memory>")

        return "\n\n".join(parts)

    def retrieve_chunks(self, query: str, top_k: int = 2) -> str:
        """Retrieve relevant memory chunks using BM25
        
        Args:
            query: User's question or search query
            top_k: Number of chunks to retrieve
            
        Returns:
            Formatted string containing retrieved chunks
        """
        try:
            memory_files = self.load_all_memory_files()
            
            # Combine all content for chunking
            all_chunks = []
            for file_name, content in memory_files.items():
                # Split by headers or paragraphs
                sections = re.split(r'\n(?=## )', content)
                for section in sections:
                    if section.strip():
                        all_chunks.append({
                            'file': file_name,
                            'content': section.strip()
                        })
            
            if not all_chunks:
                return ""
            
            # Tokenize chunks for BM25 (simple space splitting for now)
            tokenized_corpus = [chunk['content'].split() for chunk in all_chunks]
            bm25 = BM25Okapi(tokenized_corpus)
            
            tokenized_query = query.split()
            top_n = bm25.get_top_n(tokenized_query, all_chunks, n=top_k)
            
            context_parts = ["You have access to memory:", "<context>"]
            for chunk in top_n:
                context_parts.append(f"--- from {chunk['file']} ---")
                context_parts.append(chunk['content'])
            context_parts.append("</context>")
            
            return "\n".join(context_parts)
            
        except Exception as e:
            logger.error(f"Error in retrieve_chunks: {e}")
            return ""
    
    # ==================== Read Functions ====================
    
    def load_soul(self) -> Dict[str, Any]:
        """Load SOUL.md content"""
        if self.soul_file.exists():
            return {
                'content': self.soul_file.read_text(encoding='utf-8'),
                'file': str(self.soul_file)
            }
        return {}
    
    def load_user_profile(self, user_id: Optional[int] = None) -> Dict[str, Any]:
        """Load USER.md content"""
        if self.user_file.exists():
            return {
                'content': self.user_file.read_text(encoding='utf-8'),
                'file': str(self.user_file)
            }
        return {}
    
    def load_long_term_memory(self) -> List[str]:
        """Load MEMORY.md content as list of entries"""
        if self.memory_file.exists():
            content = self.memory_file.read_text(encoding='utf-8')
            return content.split('\n')
        return []
    
    def load_agent_rules(self) -> Dict[str, Any]:
        """Load AGENTS.md content"""
        if self.agents_file.exists():
            return {
                'content': self.agents_file.read_text(encoding='utf-8'),
                'file': str(self.agents_file)
            }
        return {}
    
    # ==================== Write Functions ====================
    
    def update_soul(self, updates: Dict[str, str]):
        """Update SOUL.md with new personality information
        
        Args:
            updates: Dictionary of field->value updates (e.g. {'Name': 'Jarvis', 'Role': 'Assistant'})
        """
        try:
            content = self.soul_file.read_text(encoding='utf-8')
            
            # Map of common fields to their section headers for smarter insertion
            # But simple replacement is often enough if the field exists
            
            for field, value in updates.items():
                # Case 1: Field exists as bullet point "- Field: Value"
                # Regex to match "- Field: ..." or "- **Field**: ..."
                pattern = re.compile(fr"-\s*(\*\*)?{re.escape(field)}(\*\*)?:\s*.*", re.IGNORECASE)
                
                if pattern.search(content):
                    # Replace existing line
                    def repl(match):
                        prefix = match.group(1) or ""
                        suffix = match.group(2) or ""
                        key_part = f"- {prefix}{field}{suffix}: "
                        return f"{key_part}{value}"
                    
                    content = pattern.sub(repl, content)
                else:
                    # Case 2: Field doesn't exist, append to "Core Identity" or create new
                    # Try to find Core Identity section
                    if "## Core Identity" in content:
                        lines = content.split('\n')
                        for i, line in enumerate(lines):
                            if "## Core Identity" in line:
                                lines.insert(i + 1, f"- {field}: {value}")
                                break
                        content = '\n'.join(lines)
                    else:
                        # Append to end if no section found
                        content += f"\n- {field}: {value}"
            
            self.soul_file.write_text(content, encoding='utf-8')
            self.refresh_memory_cache()
            logger.info(f"Updated SOUL.md with: {updates}")
            
        except Exception as e:
            logger.error(f"Error updating soul: {e}")

    def update_user_profile(self, user_id: int, updates: Dict[str, str]):
        """Update USER.md with new user information
        
        Args:
            user_id: User ID
            updates: Dictionary of field->value updates
        """
        try:
            content = self.user_file.read_text(encoding='utf-8')
            
            # Update fields
            for field, value in updates.items():
                # Simple replacement strategy
                if f"**{field}**:" in content:
                    # Replace existing field
                    lines = content.split('\n')
                    for i, line in enumerate(lines):
                        if f"**{field}**:" in line:
                            lines[i] = f"- **{field}**: {value}"
                            break
                    content = '\n'.join(lines)
                else:
                    # Add new field under Basic Information or Preferences
                    if field in ['Name', 'Timezone', 'Language', 'Preferred Name']:
                        section = "## Basic Information"
                    else:
                        section = "## Preferences"
                    
                    lines = content.split('\n')
                    for i, line in enumerate(lines):
                        if line.strip() == section:
                            # Insert after section header
                            lines.insert(i + 1, f"- **{field}**: {value}")
                            break
                    content = '\n'.join(lines)
            
            self.user_file.write_text(content, encoding='utf-8')
            self.refresh_memory_cache()
            logger.info(f"Updated USER.md with: {updates}")
            
        except Exception as e:
            logger.error(f"Error updating user profile: {e}")
    
    def add_to_long_term_memory(self, fact: str, category: str = "User Preferences"):
        """Append new fact to MEMORY.md
        
        Args:
            fact: The fact or information to remember
            category: Category to add under (default: User Preferences)
        """
        try:
            content = self.memory_file.read_text(encoding='utf-8')
            
            # Find the category section
            lines = content.split('\n')
            section_found = False
            insert_index = -1
            
            for i, line in enumerate(lines):
                if line.strip() == f"## {category}":
                    section_found = True
                    insert_index = i + 1
                    # Skip to end of section
                    while insert_index < len(lines) and not lines[insert_index].startswith('##'):
                        insert_index += 1
                    break
            
            if section_found:
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
                lines.insert(insert_index, f"- [{timestamp}] {fact}")
                content = '\n'.join(lines)
                self.memory_file.write_text(content, encoding='utf-8')
                self.refresh_memory_cache()
                logger.info(f"Added to MEMORY.md: {fact}")
            else:
                logger.warning(f"Category '{category}' not found in MEMORY.md")
                
        except Exception as e:
            logger.error(f"Error adding to long-term memory: {e}")
    
    def update_agent_rules(self, workflow: Dict[str, str]):
        """Update AGENTS.md with new workflow or rule
        
        Args:
            workflow: Dictionary with 'name' and 'steps' keys
        """
        try:
            content = self.agents_file.read_text(encoding='utf-8')
            
            # Add new workflow under Workflows section
            workflow_section = f"\n### {workflow['name']}\n{workflow['steps']}\n"
            
            if "## Workflows" in content:
                content += workflow_section
            else:
                content += "\n## Workflows\n" + workflow_section
            
            self.agents_file.write_text(content, encoding='utf-8')
            self.refresh_memory_cache()
            logger.info(f"Added workflow to AGENTS.md: {workflow['name']}")
            
        except Exception as e:
            logger.error(f"Error updating agent rules: {e}")
    
    def save_daily_log(self, user_message: str, assistant_decision: str):
        """Save conversation to daily log with specified format
        
        Args:
            user_message: Original user request
            assistant_decision: Summary of AI's actions/results
        """
        try:
            now = datetime.now()
            log_filename = now.strftime('%Y-%m-%d.md')
            log_path = self.daily_logs_dir / log_filename
            
            timestamp_header = f"### {now.strftime('%Y-%m-%dT%H:%M')}"
            log_entry = f"{timestamp_header}\nUser: {user_message}\nAI: {assistant_decision}\n\n"
            
            if log_path.exists():
                with open(log_path, 'a', encoding='utf-8') as f:
                    f.write(log_entry)
            else:
                log_path.write_text(log_entry, encoding='utf-8')
                
            logger.info(f"Saved daily log entry to: {log_filename}")
            
        except Exception as e:
            logger.error(f"Error saving daily log: {e}")

    def apply_json_patch(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """Apply JSON Patch to memory files
        
        Args:
            patch: {
                "file": "memory/USER.md",
                "action": "append" | "replace" | "write" | "delete" | "read",
                "old": str | None,
                "new": str | None
            }
            
        Returns:
            Status result
        """
        file_path_str = patch.get("file", "")
        action = patch.get("action")
        old_val = patch.get("old")
        new_val = patch.get("new")
        
        # 1. Safety Check: path must be in memory/
        if not file_path_str.startswith("memory/"):
             return {"success": False, "error": "Access denied: File must be in memory/ directory."}
        
        # Resolve absolute path
        file_name = file_path_str.replace("memory/", "")
        target_file = self.base_dir / file_name
        
        # Allow 'write' to create new files in memory/
        if action == "write" or action == "append":
            pass # Creating new file is fine for write/append
        elif not target_file.exists():
             return {"success": False, "error": f"File not found: {file_path_str}"}

        try:
            if action == "read":
                content = target_file.read_text(encoding='utf-8')
                return {"success": True, "file": file_path_str, "content": content}

            elif action == "delete":
                # Safety: Don't allow deleting core files? 
                # User asked for delete capability, so we allow it but log it.
                target_file.unlink()
                self.refresh_memory_cache()
                return {"success": True, "file": file_path_str, "action": "deleted"}

            elif action == "write":
                # Overwrite or Create
                target_file.write_text(new_val or "", encoding='utf-8')
                self.refresh_memory_cache()
                return {"success": True, "file": file_path_str, "action": "written"}

            elif action == "append":
                content = target_file.read_text(encoding='utf-8') if target_file.exists() else ""
                content = content.strip() + "\n\n" + new_val.strip() + "\n"
                target_file.write_text(content, encoding='utf-8')
                self.refresh_memory_cache()
                return {"success": True, "file": file_path_str, "action": "appended"}

            elif action == "replace":
                content = target_file.read_text(encoding='utf-8')
                if not old_val:
                    return {"success": False, "error": "Action 'replace' requires 'old' value."}
                if old_val not in content:
                    return {"success": False, "error": "Target content to replace not found in file."}
                content = content.replace(old_val, new_val)
                target_file.write_text(content, encoding='utf-8')
                self.refresh_memory_cache()
                return {"success": True, "file": file_path_str, "action": "replaced"}

            else:
                return {"success": False, "error": f"Unsupported action: {action}"}
            
        except Exception as e:
            logger.error(f"Error applying patch ({action}): {e}")
            return {"success": False, "error": str(e)}

    def update_memory(self, file: str, action: str, new: str, old: Optional[str] = None) -> Dict[str, Any]:
        """Alias for apply_json_patch to match AI tool names"""
        patch = {
            "file": file,
            "action": action,
            "new": new,
            "old": old
        }
        return self.apply_json_patch(patch)
    
    # ==================== Search Functions ====================
    
    def search_memories(self, query: str) -> List[Dict[str, str]]:
        """Search for relevant memories
        
        Args:
            query: Search query
            
        Returns:
            List of matching memory entries
        """
        results = []
        
        # Search in all memory files
        for file_path in [self.user_file, self.memory_file, self.agents_file]:
            if file_path.exists():
                try:
                    content = file_path.read_text(encoding='utf-8')
                    lines = content.split('\n')
                    
                    for i, line in enumerate(lines):
                        if query.lower() in line.lower():
                            results.append({
                                'file': file_path.name,
                                'line_number': i + 1,
                                'content': line.strip()
                            })
                except Exception as e:
                    logger.error(f"Error searching {file_path.name}: {e}")
        
        return results
    
    def list_memory_files(self) -> List[str]:
        """List all memory files
        
        Returns:
            List of memory file paths
        """
        files = []
        for file_path in [self.soul_file, self.user_file, self.memory_file, self.agents_file]:
            if file_path.exists():
                files.append(str(file_path))
        return files
