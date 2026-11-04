# Ballet AI Coach：上线步骤

一共三步，大约 20 分钟：建数据库 → 填配置 → 发布网址。都做完以后，你和朋友在手机上打开网址，"添加到主屏幕"就能当 App 用。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | App 本体 |
| `config.js` | 填 Supabase 的网址和 key（第 2 步） |
| `manifest.webmanifest`, `icons/` | 让手机能"安装"到主屏幕，并显示图标 |
| `sw.js` | 离线缓存。模型下载一次后，下次打开更快 |
| `supabase/schema.sql` | 数据库建表脚本（第 1 步） |

## 第 1 步：建 Supabase 数据库（免费）

1. 打开 https://supabase.com 注册，点 **New project**。名字随便取，地区选离你近的（比如 East US），设一个数据库密码并保存好。
2. 等项目建好（1–2 分钟），左边菜单点 **SQL Editor** → **New query**，把 `supabase/schema.sql` 的全部内容粘贴进去，点 **Run**，看到 Success 就完成了。
   这一步会建好三张表（孩子、练习、每次动作）和一个私有的截图存储桶，并设置好权限：每个账号只能看到自己的数据。
3. 让登录邮件里带验证码：左边菜单 **Authentication** → **Emails**（或 Email Templates）→ 选 **Magic Link** 模板，把内容改成：

   ```html
   <h2>Ballet AI Coach 登录验证码</h2>
   <p>你的验证码是：<strong>{{ .Token }}</strong></p>
   <p>10 分钟内有效。</p>
   ```

   保存。之所以用验证码而不用登录链接：在手机上从主屏幕打开的 App 里，点邮件链接会跳到浏览器，就登录不到 App 里了。
4. **Authentication** → **Sign In / Providers**：确认 Email 是开启的（默认就是开启）。

> Supabase 自带的发信服务每小时只能发几封邮件，你和一两个朋友用够了。登录一次以后，会一直保持登录状态。

## 第 2 步：填配置

在 Supabase 左边菜单 **Project Settings** → **API**（或 API Keys），复制：

- **Project URL**，比如 `https://abcdxyz.supabase.co`
- **anon public** key（新项目里叫 **publishable** key）

打开 `config.js`，填进去：

```js
window.BALLET_CONFIG = {
  supabaseUrl: "https://abcdxyz.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

这个 key 本来就是公开用的，放在网页里没关系，数据安全由数据库的权限规则保证。**千万不要**填 `service_role` 或 secret key。

## 第 3 步：发布成网址（免费）

手机用摄像头必须是 https 网址，所以要放到网上。两种方式任选一种：

**方式 A：GitHub Pages**
1. 在 GitHub 新建一个 **public** 仓库，比如 `ballet-ai-coach`。
2. 把整个文件夹的内容上传上去（`index.html` 要在仓库根目录）。
3. 仓库 **Settings** → **Pages** → Source 选 **Deploy from a branch**，Branch 选 `main` 和 `/ (root)`，保存。
4. 等一两分钟，就会得到网址：`https://你的用户名.github.io/ballet-ai-coach/`。

**方式 B：Netlify（不用 git，拖拽上传）**
1. 打开 https://app.netlify.com/drop 并登录。
2. 把整个文件夹拖进去，马上就会给你一个 https 网址。

最后回到 Supabase：**Authentication** → **URL Configuration**，把 **Site URL** 改成你的网址。

## 在手机上安装

- **iPhone**：用 Safari 打开网址 → 点分享按钮 → **添加到主屏幕**。
- **安卓**：用 Chrome 打开 → 菜单 → **安装应用**（或"添加到主屏幕"）。

第一次打开时，允许使用摄像头。在「账号与同步」里输入邮箱 → 收验证码 → 登录 → 添加孩子的名字，就可以开始练习了。

## 给朋友用

把网址发给朋友。每个家庭用自己的邮箱登录，数据互相看不到。

## 数据存在哪里

| 内容 | 位置 |
|---|---|
| 每次动作的判断结果、练习总结 | Supabase 数据库 |
| 每次动作的三张关键帧截图 | Supabase 私有存储（只有本人账号能看） |
| 腿部 12 个关键点的逐帧坐标 | Supabase 数据库（`reps.coords`） |
| 录像 | **只在手机或电脑上，不上传** |
| 全部 33 个关键点的逐帧坐标 CSV | 点「导出逐帧坐标」下载到本机 |

按免费额度（500 MB 数据库、1 GB 存储）估算：每次动作的截图约 75 KB、坐标约 20 KB，大约能存一万次动作。

## 需要知道的

- **一周没人用，Supabase 免费项目会自动暂停。** 暂停后，App 本身还能用，只是不能同步。这时登录 Supabase 后台点 **Restore** 就能恢复，数据不会丢。
- **更新 App**：改完文件重新上传后，把 `sw.js` 第一行的 `VERSION` 改个数字（比如 `bac-v2`），这样手机上会自动换成新版本（可能要打开两次）。
- 不填 `config.js` 也能用，只是没有账号和云同步，数据只存在当前设备上。
- 想查看数据：Supabase 后台 **Table Editor** 能直接看表，也可以在 **SQL Editor** 里写查询，比如：

  ```sql
  select d.name, s.started_at, s.total, s.good
  from sessions s join dancers d on d.id = s.dancer_id
  order by s.started_at desc;
  ```
