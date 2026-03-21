export class RiverMine{
    constructor(x, y, {reward = 10, level = 1} = {}) {
        this.x = x;
        this.y = y;
        this.type = "riverMine";
        this.color = "blue";
        this.reward = reward;
        this.level = level;
    }

    place(setCell) {
        setCell(this.x, this.y, this.color);
    }

    mine(){
        const goldValue = Math.floor(Math.random() * 10) + 1; // random gold value between 1 and 10
        return goldValue;
    }
}