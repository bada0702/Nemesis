
class TradingCalcSkill:
    def execute_tool(self, tool_name, args):
        if tool_name == "calculate_return":
            buy_price = float(args.get("buy_price", 0))
            current_price = float(args.get("current_price", 0))
            quantity = float(args.get("quantity", 0))
            
            if buy_price == 0:
                return {"error": "평균단가가 0원일 수 없습니다."}
            
            profit_loss = (current_price - buy_price) * quantity
            return_pct = ((current_price - buy_price) / buy_price) * 100
            
            return {
                "return_pct": round(return_pct, 4),
                "profit_loss": int(profit_loss),
                "status": "PROFIT" if return_pct > 0 else "LOSS" if return_pct < 0 else "BREAK_EVEN"
            }

    def get_tool_definitions(self):
        return [
            {
                "name": "calculate_return",
                "description": "평균단가와 현재가를 바탕으로 정확한 수익률과 평가손익을 계산합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "buy_price": {"type": "string", "description": "평균 단가"},
                        "current_price": {"type": "string", "description": "현재가"},
                        "quantity": {"type": "string", "description": "보유 수량"}
                    },
                    "required": ["buy_price", "current_price", "quantity"]
                }
            }
        ]
