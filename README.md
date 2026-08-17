# Local Study AI — Groq GPT-OSS 120B — RAG FIX

Bản này giữ nguyên phiên bản Groq GPT-OSS 120B FINAL CLEAN và sửa lỗi RAG khi yêu cầu xử lý toàn bộ tài liệu đang chọn.

## Đã sửa
- "Tóm tắt file t chọn" không còn phụ thuộc lexical search.
- Summary / Explain / Quiz / Flashcard / Outline / Exam dùng trực tiếp chunks của tài liệu đang chọn.
- Nếu truy vấn thông thường không tìm thấy chunk, hệ thống có fallback vào vài chunk đầu của tài liệu đang chọn.
- Tăng MAX_CONTEXT từ 10.000 lên 30.000 ký tự.
- AI được yêu cầu không trả lời "chưa nhận được file" khi context tài liệu đã được truyền.
- Giữ nguyên Groq API và model `openai/gpt-oss-120b`.

## Cài đặt
1. Mở `script.js`.
2. Dán Groq API key vào `GROQ_API_KEY`.
3. Upload toàn bộ các file lên GitHub Pages.
4. Hard refresh trang.
