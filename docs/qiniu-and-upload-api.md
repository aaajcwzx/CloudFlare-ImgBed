# 七牛云渠道与上传 API

## 七牛云 Kodo

上游已有 S3 兼容存储渠道；七牛云 Kodo 官方也支持 S3。本 Fork 在现有 S3 渠道中增加七牛云配置预设，复用普通上传、分块上传、文件读取、删除、重命名/移动、有效期清理等已有 S3 路径。文件记录继续使用 `Channel: S3`，以保持管理和历史数据兼容。

管理界面：系统设置 → 上传设置 → 添加渠道 → S3 → 存储服务商：七牛云 Kodo。填写渠道名、七牛 Access Key / Secret Key、七牛 **S3 空间名**，选择实际存储区域。预设自动填写区域 Endpoint 和路径风格；CDN 域名可选。空间名请在七牛控制台“对象存储 → 空间管理 → 空间概览”查看 S3 空间名，可能与普通空间名不同。

支持区域：`cn-east-1`、`cn-east-2`、`cn-north-1`、`cn-south-1`、`us-north-1`、`ap-southeast-1`、`ap-southeast-2`、`ap-southeast-3`。例如华东浙江使用 `https://s3.cn-east-1.qiniucs.com`。S3 Endpoint 的访问需要签名；它不是可匿名打开的 CDN 域名。

也可使用后端环境变量：

| 变量 | 内容 |
| --- | --- |
| `QINIU_ACCESS_KEY` | 七牛 AK |
| `QINIU_SECRET_KEY` | 七牛 SK，存为部署平台 Secret |
| `QINIU_BUCKET_NAME` | 七牛 S3 空间名 |
| `QINIU_REGION` | 实际区域，默认 `cn-east-1` |
| `QINIU_CDN_DOMAIN` | 可选完整 CDN 地址前缀 |

环境变量生成的渠道名为 `Qiniu_env`。多个七牛云渠道可使用管理界面配置，支持现有 S3 的负载均衡及容量限制。API 调用 `uploadChannel=qiniu` 时只匹配启用的七牛云渠道；指定的 `channelName` 不存在时返回 400。上传失败不会自动切换到其他服务商。现有 `uploadChannel=s3` 和七牛云 S3 Endpoint 配置继续可用。

## 已有的开放上传 API

项目已有上传 API，无需新增接口。先在管理后台的 API Token 设置创建 Token，勾选 `upload` 权限。调用方式：

| 项目 | 值 |
| --- | --- |
| 方法和路径 | `POST /upload` |
| 认证 | `Authorization: Bearer <API_TOKEN>` |
| 请求体 | `multipart/form-data`，字段 `file` |
| 渠道 | `uploadChannel=telegram/cfr2/s3/discord/huggingface/webdav`，本 Fork 增加 `qiniu` 别名 |
| 指定渠道 | `channelName=你配置的渠道名称` |
| 完整链接 | `returnFormat=full` |
| 对象响应 | `responseFormat=object`；默认仍为数组 |
| 上传目录 | `uploadFolder=photos` |
| 禁止失败后切换渠道 | `autoRetry=false` |

以下是 PowerShell 中的示例；替换 Token、渠道名和文件路径。`curl.exe` 会自动设置 multipart boundary，不要手动覆盖 Content-Type。

```powershell
curl.exe --fail-with-body `
  -H "Authorization: Bearer YOUR_UPLOAD_TOKEN" `
  -F "file=@D:/pictures/photo.jpg" `
  "https://imgs.5849527.top/upload?uploadChannel=qiniu&channelName=Qiniu&uploadFolder=photos&returnFormat=full&responseFormat=object&autoRetry=false"
```

成功响应示例：

```json
{"src":"https://imgs.5849527.top/file/photos/example.jpg"}
```

也可能返回 `publicUrl`、`expiresAt` 等字段，取决于配置。调用旧版本或默认数组格式时读取响应的第一个对象的 `src`。Python 示例：

```python
import os
import requests

with open("photo.jpg", "rb") as image:
    response = requests.post(
        "https://imgs.5849527.top/upload",
        headers={"Authorization": f"Bearer {os.environ['IMGBED_UPLOAD_TOKEN']}"},
        params={"uploadChannel": "qiniu", "channelName": "Qiniu",
                "returnFormat": "full", "responseFormat": "object", "autoRetry": "false"},
        files={"file": ("photo.jpg", image, "image/jpeg")},
        timeout=60,
    )
response.raise_for_status()
result = response.json()
print((result[0] if isinstance(result, list) else result)["src"])
```

未配置七牛云或未部署本 Fork 时，请选择已存在的渠道并使用 `uploadChannel=s3` 等现有参数。七牛 AK/SK 配置在图床后端，第三方调用图床只需图床 API Token。API 开放意味着可供程序调用，仍受认证、IP 限制和上传规则控制。

`GET /api/channels` 可使用 Token 查询已配置渠道名称，返回的 `s3` 数组包含七牛云渠道以及可选 `provider: qiniu` 标识。大文件沿用已有 S3 分块 API，初始化、分块、合并请求均保持同一 `uploadChannel=qiniu` 和 `channelName` 参数；每个分块仍受部署平台请求体限制。

验证范围：回归测试使用模拟存储传输和真实 AWS SDK 签名，未使用真实七牛云凭据执行上传、读取或删除。上线后需要用专门的测试文件完成实际七牛云验证。

官方参考：
- 七牛 S3 服务域名：`https://developer.qiniu.com/kodo/4088/s3-access-domainname`
- 项目上传 API：`https://cfbed.sanyue.de/api/upload.html`
