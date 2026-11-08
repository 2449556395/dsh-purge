// Optional Windows-only file switch. Built from source; no network requests or host-process controls.
// The file $DSH_HOME\.inject-off is shared with the dsh-purge plugin.
using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace DshPurgeInjectSwitch
{
    internal static class Program
    {
        internal static string DshHome
        {
            get
            {
                string configured = Environment.GetEnvironmentVariable("DSH_HOME");
                return !String.IsNullOrWhiteSpace(configured)
                    ? configured.Trim()
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh");
            }
        }

        internal static string FlagPath { get { return Path.Combine(DshHome, ".inject-off"); } }
        internal static bool IsOff { get { return File.Exists(FlagPath); } }

        internal static void SetOff(bool off)
        {
            if (off)
            {
                Directory.CreateDirectory(DshHome);
                File.WriteAllText(FlagPath, DateTime.UtcNow.ToString("o") + Environment.NewLine, Encoding.UTF8);
            }
            else if (File.Exists(FlagPath))
            {
                File.Delete(FlagPath);
            }
        }

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SwitchForm());
        }
    }

    internal sealed class SwitchForm : Form
    {
        private readonly Label state = new Label();
        private readonly Button toggle = new Button();
        private readonly Timer refresh = new Timer();

        internal SwitchForm()
        {
            Text = "DSH · 提示词注入开关";
            ClientSize = new Size(460, 255);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(27, 29, 34);
            ForeColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9F);

            Label title = new Label();
            title.Text = "DSH 提示词注入";
            title.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold);
            title.Location = new Point(24, 18);
            title.AutoSize = true;
            Controls.Add(title);

            state.Location = new Point(24, 60);
            state.Size = new Size(412, 29);
            state.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold);
            Controls.Add(state);

            toggle.Location = new Point(24, 100);
            toggle.Size = new Size(412, 55);
            toggle.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold);
            toggle.FlatStyle = FlatStyle.Flat;
            toggle.FlatAppearance.BorderSize = 0;
            toggle.ForeColor = Color.White;
            toggle.Click += ToggleClicked;
            Controls.Add(toggle);

            Label hint = new Label();
            hint.Text = "只控制提示词注入。工具、补丁、演练台与权限设置保持原样。";
            hint.ForeColor = Color.Silver;
            hint.Location = new Point(24, 170);
            hint.Size = new Size(412, 28);
            Controls.Add(hint);

            Label file = new Label();
            file.Text = Program.FlagPath;
            file.Font = new Font("Consolas", 8F);
            file.ForeColor = Color.Gray;
            file.AutoEllipsis = true;
            file.Location = new Point(24, 213);
            file.Size = new Size(412, 24);
            Controls.Add(file);

            refresh.Interval = 1000;
            refresh.Tick += delegate { RenderState(); };
            refresh.Start();
            RenderState();
        }

        private void ToggleClicked(object sender, EventArgs e)
        {
            toggle.Enabled = false;
            try
            {
                Program.SetOff(!Program.IsOff);
            }
            catch (Exception error)
            {
                MessageBox.Show("开关写入失败：" + error.Message, "DSH 提示词开关",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                toggle.Enabled = true;
                RenderState();
            }
        }

        private void RenderState()
        {
            bool off = Program.IsOff;
            state.Text = off ? "● 注入已暂停" : "● 注入正在启用";
            state.ForeColor = off ? Color.Salmon : Color.LightGreen;
            toggle.Text = off ? "恢复注入" : "暂停注入";
            toggle.BackColor = off ? Color.FromArgb(46, 125, 92) : Color.FromArgb(161, 58, 58);
            Text = "DSH · 提示词注入开关 — " + (off ? "已暂停" : "已启用");
        }
    }
}
