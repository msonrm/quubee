#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/* bridge.c から呼ぶ。dx/dy は相対移動 (任意の正負整数)。 */
void qb_mouse_post_move(int dx, int dy);

/* button: 0=左, 1=右. down: 1=押下, 0=解放 */
void qb_mouse_post_button(int button, int down);

#ifdef __cplusplus
}
#endif
