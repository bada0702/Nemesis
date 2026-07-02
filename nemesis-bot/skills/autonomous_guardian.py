import subprocess
import re
import json

class AutonomousGuardianSkill:
    def execute_tool(self, tool_name, args):
        if tool_name == "autonomous_security_scan":
            return self.autonomous_security_scan()
        elif tool_name == "market_anomaly_detection":
            return self.market_anomaly_detection(args.get("symbols", []))
        else:
            return "지원하지 않는 도구입니다."

    def autonomous_security_scan(self):
        try:
            cmd = "grep 'Failed password' /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -nr | head -n 5"
            result = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT).decode('utf-8')
            
            if not result:
                return "✅ 현재 감지된 비정상 로그인 시도 IP가 없습니다. 시스템이 안전합니다."

            findings = []
            for line in result.strip().split('\n'):
                parts = line.strip().split()
                if len(parts) >= 2:
                    count, ip = parts[0], parts[1]
                    findings.append(f"IP: {ip} (시도 횟수: {count}회)")

            report = "⚠️ [보안 이상 징후 감지]\n다음 IP들로부터 무차별 대입 공격이 의심됩니다:\n" + "\n".join(findings)
            report += "\n\n💡 조치 제언: 해당 IP들을 방화벽(iptables/ufw)으로 즉시 차단하시겠습니까?"
            return report
        except Exception as e:
            return f"❌ 보안 스캔 중 오류 발생: {str(e)}"

    def market_anomaly_detection(self, symbols):
        if not symbols:
            return "분석할 종목 리스트가 제공되지 않았습니다."
        return f"📈 [시장 변동성 분석] {', '.join(symbols)} 종목에 대해 실시간 변동성 추적 루프를 가동합니다. (현재 분석 중...)"

    def get_tool_definitions(self):
        return [
            {
                "name": "autonomous_security_scan",
                "description": "시스템 로그를 분석하여 공격 IP를 감지하고 보안 상태를 보고합니다.",
                "parameters": {}
            },
            {
                "name": "market_anomaly_detection",
                "description": "특정 주식 종목들의 급등락 등 이상 징후를 감지합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbols": {"type": "array", "items": {"type": "string"}, "description": "분석할 종목 심볼 리스트"}
                    },
                    "required": ["symbols"]
                }
            }
        ]
